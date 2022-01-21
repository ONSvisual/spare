//test if browser supports webGL
Modernizr.on('webgl',function(results){
  if(results){
    //setup pymjs
    var pymChild = new pym.Child();
    var regionLookup = {};
    var dateLookup = {};
    var decileEPC = {
      'England': {
        1: .4660,
        2: .4650,
        3: .4610,
        4: .4300,
        5: .4140,
        6: .4130,
        7: .3970,
        8: .3950,
        9: .3870,
        10: .3620
      },
      'Wales': {
        1: .4490,
        2: .4130,
        3: .3810,
        4: .3480,
        5: .3430,
        6: .3420,
        7: .3250,
        8: .3510,
        9: .4100,
        10: .3490
      }
    }
    var regionEPC = {
      'East Midlands': .4030,
      'East of England': .4280,
      'London':	.4850,
      'North East':	.4140,
      'North West':	.4060,
      'South East':	.4370,
      'South West':	.4210,
      'Wales': .3730,
      'West Midlands': .3750,
      'Yorkshire and The Humber': .3770
    }


    //Load data and config file
    d3.queue()
      .defer(d3.json, "data/config.json")
      .defer(d3.csv, "data/data.csv")
      .defer(d3.csv, "data/epcs.csv")
      .defer(d3.csv, "data/LSOA_LU.csv")
      .await(ready);

    function ready(error, config, data, epcs, lsoaRegion) {

      //turn csv data into json format
      json = csv2json(epcs);

      lsoaRegion.forEach(d => {
        regionLookup[d['lsoa11cd']] = {'rName': d['Region'], 'rCode': d['RGN11CD'], 'lName': d['LA name'], 'lCode': d['LA code'], 'decile': d['Deprivation decile'], 'name': d['LSOA name'], 'country': d['Country']};
      });

      epcs.forEach(d => {
        dateLookup[d['areacd']] = {'value': +d['value'], 'b1900': d['b1900']/100, 'a2012': d['a2012']/100 }
      });

      getCodes('EC1A 4HJ')
      width = parseInt(d3.select('body').style('width')); //this will get the width of your screen.;


      //Set up global variables
      dvc = config.ons;
      hoveredId = null;

      //set title of page
      document.title = dvc.maptitle;

      //Set up number formats
      displayformat = d3.format(",." + dvc.displaydecimals + "f");
      legendformat = d3.format(",");

        //set up basemap
        map = new mapboxgl.Map({
          container: 'map', // container id
          style: 'data/style.json', //stylesheet location
          center: [-0.12, 51.5], // starting position 51.5074° N, 0.1278
          maxBounds: [[-12.836, 49.441], [7.604, 55.945]],//limit it to just E&W
          zoom: 12, // starting zoom
          minZoom: 4,
          maxZoom: 16.99, //
          attributionControl: false
        });
        //add fullscreen option
        map.addControl(new mapboxgl.FullscreenControl());

        // Add zoom and rotation controls to the map.
        map.addControl(new mapboxgl.NavigationControl());

        // Disable map rotation using right click + drag
        map.dragRotate.disable();

        // Disable map rotation using touch rotation gesture
        map.touchZoomRotate.disableRotation();

        // Add geolocation controls to the map.
        map.addControl(new mapboxgl.GeolocateControl({
          positionOptions: {
            enableHighAccuracy: true
          }
        }));

        //add compact attribution
        map.addControl(new mapboxgl.AttributionControl({
          compact: true,
          // add zoomstack attribution
          customAttribution: "Contains OS data © Crown copyright and database right (" + new Date().getFullYear() + ")"
        }));

        //define mouse pointer
        map.getCanvasContainer().style.cursor = 'pointer';

        addFullscreen();

        // if breaks is jenks or equal
        // get all the numbers, filter out the blanks, and then sort them
        breaks = generateBreaks(data, dvc);

        //Load colours
        if (typeof dvc.varcolour === 'string') {
          colour = colorbrewer[dvc.varcolour][dvc.numberBreaks];
        } else {
          colour = dvc.varcolour;
        }

        //set up d3 color scales
        color = d3.scaleThreshold()
          .domain(breaks.slice(1))
          .range(colour);

        //now ranges are set we can call draw the key
        createKey(dvc);

        map.on('load', function() {

          // Add boundaries tileset
          map.addSource('lsoa-tiles', {
            type: 'vector',
            tiles: ['https://cdn.ons.gov.uk/maptiles/administrative/lsoa/v1/boundaries/{z}/{x}/{y}.pbf'],
            "promoteId": {
              "boundaries": "AREACD"
            },
            minzoom:4,
            maxzoom: 12,
          });

          map.addLayer({
            id: 'lsoa-boundaries',
            type: 'fill',
            source: 'lsoa-tiles',
            'source-layer': 'boundaries',
            minzoom:4,
            maxzoom:17,
            paint: {
              'fill-color': ['case',
                ['!=', ['feature-state', 'colour'], null],
                ['feature-state', 'colour'],
                'rgba(255, 255, 255, 0)'
              ],
              'fill-opacity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                8,
                0.9,
                9,
                0.1
              ]
            }
          }, 'place_suburb');

          // Add buildings tileset
          map.addSource('building-tiles', {
            type: 'vector',
            tiles: ['https://cdn.ons.gov.uk/maptiles/administrative/lsoa/v1/buildings/{z}/{x}/{y}.pbf'],
            promoteId: {
              buildings: "AREACD"
            },
            minzoom: 8,
            maxzoom: 12,
          });

          // Add layer from the vector tile source with data-driven style
          map.addLayer({
            id: 'lsoa-building',
            type: 'fill',
            source: 'building-tiles',
            'source-layer': 'buildings',
            minzoom:8,
            maxzoom:17,
            paint: {
              'fill-color': ['case',
                ['!=', ['feature-state', 'colour'], null],
                ['feature-state', 'colour'],
                'rgba(255, 255, 255, 0)'
              ],
              'fill-opacity': 0.8
            }
          }, 'place_suburb');

          //loop the json data and set feature state for building layer and boundary layer
          for (var key in json) {
            // setFeatureState for buildlings
            map.setFeatureState({
              source: 'building-tiles',
              sourceLayer: 'buildings',
              id: key
            }, {
              colour: getColour(json[key])
            });

            //setFeatureState for boundaries
            map.setFeatureState({
              source: 'lsoa-tiles',
              sourceLayer: 'boundaries',
              id: key
            }, {
              colour: getColour(json[key])
            });
          }

          //outlines around LSOA
          map.addLayer({
            id: "lsoa-outlines",
            type: "line",
            source: 'lsoa-tiles',
            minzoom: 4,
            maxzoom: 17,
            "source-layer": "boundaries",
            "background-color": "#ccc",
            paint: {
              'line-color': 'orange',
              "line-width": 3,
              "line-opacity": [
                'case',
                ['boolean', ['feature-state', 'hover'], false],
                1,
                0
              ]
            },
          }, 'place_suburb');

          //get location on click
          d3.select(".mapboxgl-ctrl-geolocate").on("click", geolocate);

        });

      // clears search box on click
      // $(".search-control").click(function() {
      //   $(".search-control").val('');
      // });

      // if you push enter while in the box
      d3.select(".search-control").on("keydown", function() {
        if (d3.event.keyCode === 13) {
          d3.event.preventDefault();
          d3.event.stopPropagation();
          getCodes($(".search-control").val());
        }
      });
      //if you click on the search icon, find the postcode
      $("#submitPost").click(function(event) {
        event.preventDefault();
        event.stopPropagation();
        getCodes($(".search-control").val());
      });

      //if you focus on the search icon and push space or enter
      d3.select("#submitPost").on("keydown", function() {
        if (d3.event.keyCode === 13 || d3.event.keyCode === 32) {
          event.preventDefault();
          event.stopPropagation();
          getCodes($(".search-control").val());
        }
      });

      // When the user moves their mouse over the lsoa boundaries layer, we'll update the
      // feature state for the feature under the mouse.
      map.on('mousemove', 'lsoa-boundaries', onMove);

      // When the mouse leaves the lsoa boundaries layer, update the feature state of the
      // previously hovered feature.
      map.on('mouseleave', 'lsoa-boundaries', onLeave);

      map.on('click', 'lsoa-boundaries', onClick);

      function onClick(e) {
        disableMouseEvents();
        highlightArea(e.features);
        addClearBox();
      }

      function addClearBox() {
        if(d3.select('#clearbutton').empty()){
          d3.select('#keydiv').append('button').attr('id', 'clearbutton').attr('class', 'clear').text("Clear area").attr('tabindex', 0);
          d3.select('#clearbutton').on('click', removeClearBox);
          d3.select("#clearbutton").on("keydown", function() {
            if (d3.event.keyCode === 13 || d3.event.keyCode === 32) {
              event.preventDefault();
              event.stopPropagation();
              removeClearBox();
            }
          });
        }
      }

      function removeClearBox() {
        d3.select("#clearbutton").remove();
        enableMouseEvents();
        hideaxisVal();
        unhighlightArea();
      }

      function disableMouseEvents() {
        map.off('mousemove', 'lsoa-boundaries', onMove);
        map.off('mouseleave', 'lsoa-boundaries', onLeave);
      }
      //
      function enableMouseEvents() {
        map.on('mousemove', 'lsoa-boundaries', onMove);
        map.on('mouseleave', 'lsoa-boundaries', onLeave);
      }

      function createKey(dvc) {
        keywidth = d3.select("#keydiv").node().getBoundingClientRect().width;

        var svgkey = d3.select("#keydiv")
          .attr("width", keywidth);

        d3.select("#keydiv")
          .style("font-family", "Open Sans")
          .style("font-size", "14px")
          .append("p")
          .attr("id", "keyvalue")
          .style("font-size", "18px")
          .style("margin-top", "10px")
          .style("margin-bottom", "5px")
          .style("margin-left", "10px")
          .text("");

        d3.select("#keydiv")
          .append("p")
          .attr("id", "keyunit")
          .style("margin-top", "5px")
          .style("margin-bottom", "5px")
          .style("margin-left", "10px")
          .text(dvc.varunit);

        stops = d3.zip(breaks,colour);

        divs = svgkey.selectAll("div")
          .data(breaks)
          .enter()
          .append("div");

        divs.append("div")
          .style("height", "20px")
          .style("width", "10px")
          .attr("float", "left")
          .style("display", "inline-block")
          .style("background-color", function(d, i) {
            if (i != breaks.length - 1) {
              return stops[i][1];
            } else {
              return dvc.nullColour;
            }
          });

        divs.append("p")
          .attr("float", "left")
          .style("padding-left", "5px")
          .style("margin", "0px")
          .style("display", "inline-block")
          .style("position", "relative")
          .style("top", "-5px")
          .text(function(d, i) {
            if (i != breaks.length - 1) {
              return "" + displayformat(breaks[i]) + "% to " + displayformat(breaks[i + 1] - 1)+"%";
            } else {
              return "No Data";
            }
          });
      } // Ends create key

      function addFullscreen() {
        currentBody = d3.select("#map").style("height");
        d3.select(".mapboxgl-ctrl-fullscreen").on("click", setbodyheight);
      }

      function setbodyheight() {
        d3.select("#map").style("height", "100%");

        document.addEventListener('webkitfullscreenchange', exitHandler, false);
        document.addEventListener('mozfullscreenchange', exitHandler, false);
        document.addEventListener('fullscreenchange', exitHandler, false);
        document.addEventListener('MSFullscreenChange', exitHandler, false);

      }


      function exitHandler() {
        if (document.webkitIsFullScreen === false) {
          shrinkbody();
        } else if (document.mozFullScreen === false) {
          shrinkbody();
        } else if (document.msFullscreenElement === false) {
          shrinkbody();
        }
      }

      function shrinkbody() {
        d3.select("#map").style("height", currentBody);
        pymChild.sendHeight();
      }

      function geolocate() {
        dataLayer.push({
          'event': 'geoLocate',
          'selected': 'geolocate'
        });

        var options = {
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 0
        };

        navigator.geolocation.getCurrentPosition(success, error, options);
      }

      function getCodes(myPC) {

        //first show the remove cross
        d3.select(".search-control").append("abbr").attr("class", "postcode");

        dataLayer.push({
          'event': 'geoLocate',
          'selected': 'postcode'
        });

        var myURIstring = encodeURI("https://api.postcodes.io/postcodes/" + myPC);
        $.support.cors = true;
        $.ajax({
          type: "GET",
          crossDomain: true,
          dataType: "jsonp",
          url: myURIstring,
          error: function(xhr, ajaxOptions, thrownError) {
            d3.select("#keyvalue").text("Enter a valid postcode");
            d3.select("#screenreadertext").text("Enter a valid postcode");
            d3.select("#robo-text").html(function() {
              return 'Please enter a valid postcode'
            });
          },
          success: function(data1) {
            if (data1.status == 200) {
              if ((data1.result.country=="England") | (data1.result.country=="Wales")) {
                lat = data1.result.latitude;
                lng = data1.result.longitude;
                successpc(lat, lng);
              } else {
                d3.select("#keyvalue").text("Enter a valid postcode");
                d3.select("#screenreadertext").text("Enter a valid postcode");
                d3.select("#robo-text").html(function() {
                  return 'Please enter an English or Welsh postcode'
                });
              }
            } else {
              d3.select("#keyvalue").text("Enter a valid postcode");
              d3.select("#screenreadertext").text("Enter a valid postcode");
              d3.select("#robo-text").html(function() {
                return 'Please enter a valid postcode'
              });
            }
          }

        });
        pymChild.sendHeight();
      }


      function successpc(lat, lng) {
        map.jumpTo({
          center: [lng, lat],
          zoom: 12
        });
        point = map.project([lng, lat]);

        setTimeout(function() {
          var tilechecker = setInterval(function() {
            features = null;
            var features = map.queryRenderedFeatures(point, {
              layers: ['lsoa-boundaries']
            });
            if (features.length != 0) {
              highlightArea(features);
              disableMouseEvents();
              addClearBox();
              clearInterval(tilechecker);
            }
          }, 500);
        }, 500);
      }

      function onMove(e) {
        highlightArea(e.features);
      }

      setTimeout(function(){
        let te = [{'id': "E01000001", 'properties': {'AREANM': "City of London 001A", 'AREACD': "E01000001"}}]
        initHighlightArea(te)

      }, 50);



    function initHighlightArea(e) {
      setAxisVal(e[0].properties.AREANM, json[e[0].properties.AREACD], e[0].properties.AREACD);
      setScreenreader(e[0].properties.AREANM, json[e[0].properties.AREACD]);

      if (e.length > 0) {
        if (hoveredId) {
          map.setFeatureState({
            source: 'lsoa-tiles',
            sourceLayer: 'boundaries',
            id: hoveredId
          }, {
            hover: false
          });
        }

        hoveredId = e[0].id;

        setTimeout(function(){
          map.setFeatureState({
            source: 'lsoa-tiles',
            sourceLayer: 'boundaries',
            id: hoveredId
          }, {
            hover: true
          });
        }, 700);
      }
    }


    function highlightArea(e) {
      setAxisVal(e[0].properties.AREANM, json[e[0].properties.AREACD], e[0].properties.AREACD);
      setScreenreader(e[0].properties.AREANM, json[e[0].properties.AREACD]);

      if (e.length > 0) {
        if (hoveredId) {
          map.setFeatureState({
            source: 'lsoa-tiles',
            sourceLayer: 'boundaries',
            id: hoveredId
          }, {
            hover: false
          });
        }

        hoveredId = e[0].id;

        map.setFeatureState({
          source: 'lsoa-tiles',
          sourceLayer: 'boundaries',
          id: hoveredId
        }, {
          hover: true
        });
      }
    }

    function unhighlightArea(){
      if (hoveredId) {
        map.setFeatureState({
          source: 'lsoa-tiles',
          sourceLayer: 'boundaries',
          id: hoveredId
        }, {
          hover: false
        });
      }
      hoveredId = null;
    }


    function generateBreaks(data, dvc) {
      if (!Array.isArray(dvc.breaks)) {
        values = data.map(function(d) {
          return +d.value;
        }).filter(function(d) {
          if (!isNaN(d)) {
            return d;
          }
        }).sort(d3.ascending);
      }


      if (dvc.breaks == "jenks") {
        breaks = [];

        ss.ckmeans(values, (dvc.numberBreaks)).map(function(cluster, i) {
          if (i < dvc.numberBreaks - 1) {
            breaks.push(cluster[0]);
          } else {
            breaks.push(cluster[0]);
            //if the last cluster take the last max value
            breaks.push(cluster[cluster.length - 1]);
          }
        });
      } else if (dvc.breaks == "equal") {
        breaks = ss.equalIntervalBreaks(values, dvc.numberBreaks);
      } else {
        breaks = dvc.breaks;
      }

      //round breaks to specified decimal places
      breaks = breaks.map(function(each_element) {
        return Number(each_element.toFixed(dvc.legenddecimals));
      });

      return breaks;
    }

    function onLeave() {
      if (hoveredId) {
        map.setFeatureState({
          source: 'lsoa-tiles',
          sourceLayer: 'boundaries',
          id: hoveredId
        }, {
          hover: false
        });
      }
      hoveredId = null;
    }

    function setAxisVal(areanm, areaval, areacd) {
      d3.select("#robo-text").html(function() {
        if (!isNaN(areaval)) {
          let string = `
mixin para1
  strong
    | #[+value(fracWord[0])]
    span#blue
      | #[+value(fracWord[1])]
      | homes
    span
    | (#[+value(frac, {'FORMAT': '0%'})])
    | in this part of
    if (loc=="City of London")
      | the
    span#blue
      | #[+value(loc)]
    span
    | have an EPC rating of C or above
  strong
  if (Math.abs(diff)>0.08)
    | — considerably
    if (diff<0)
      | less than
    else
      | more than
  else if (Math.abs(diff)>0.04)
    |—somewhat
    if (diff<0)
      | less than
    else
      | more than
  else if (Math.abs(diff)>0.01)
    |—slightly
    if (diff<0)
      | less than
    else
      | more than
  else
    | close to
  | the average across
  | #[+value(parent)]
  | (#[+value(regionaVal, {'FORMAT': '0%'})]).


mixin age
  | Across
  if (loc=="City of London")
    | the
  | #[+value(loc)],
  strong
    | #[+value(b1900, {'FORMAT': '0%'})] of homes were constructed
    span#blue
      | before 1900,
  | and
  strong
    | #[+value(a2012, {'FORMAT': '0%'})] were constructed
    span#blue
      | in 2012 or later.

mixin para2
  strong
    if (decile==5 | decile==6)
      | This neighbourhood has
      span#blue
        | levels of deprivation close to the average
      span
      | across
      if (country=='England')
        | England.
      if (country=='Wales')
        | Wales.
    else
      if (decile==1 | decile==10)
        | This neighbourhood is
        span#blue
          | considerably
        span#end -
      else if (decile<4 | decile>7)
        | This neighbourhood is
        // span#blue
        //   | somewhat
        // span#end -
      else
        | This neighbourhood is
        span#blue
          | slightly
        span#end -
      if (decile<5)
        span#blue
          | more deprived
        span
        | than the average area across
        if (country=='England')
          | England
        if (country=='Wales')
          | Wales
      else if (decile>6)
        span#blue
          | less deprived
        span
        | than the average area across
        if (country=='England')
          | England
        if (country=='Wales')
          | Wales
  strong
  if (decile<5)
    | (among the top #[+value(decile/10, {'FORMAT': '0%'})] most deprived).
  else if (decile>6)
    | (among the top #[+value((11-decile)/10, {'FORMAT': '0%'})] least deprived).
  | In
  if (country=='England')
    | English
  if (country=='Wales')
    | Welsh
  | neighbourhoods with a similar level of deprivation, about
  | #[+value(deprivation, {'FORMAT': '0%'})]
  | of homes are considered energy efficient.

p #[+para1]
p #[+age]
`
          var lastIndex = areanm.lastIndexOf(" ");
          let loc = areanm.substring(0, lastIndex)
          let frac = Math.round(areaval*10)/1000

          let fraction_map = {'one in two': 0.5, 'one in three': 0.333, 'one in four': 0.25, 'one in five': 0.2, 'one in six': 0.167, 'one in seven': 0.143, 'one in eight': 0.125, 'one in nine': 0.111, '1 in 10': 0.1,'1 in 11' : 0.09, '1 in 12' : 0.083, '1 in 13' : 0.077, '1 in 14' : 0.071, '1 in 15' : 0.067, '1 in 16' : 0.063, '1 in 17' : 0.059, '1 in 18' : 0.056, '1 in 19' : 0.053 ,'1 in 20': 0.05, '2 in 10': 0.2, '3 in 10': 0.3, '4 in 10': 0.4, '6 in 10': 0.6, '7 in 10': 0.7, '8 in 10': 0.8, '9 in 10': 0.9, 'all': 1.0}
          let OverUnder;
          function get_word(fraction) {
              let lowest = 2;
              let lowest_label;
              for (const label in fraction_map) {
                  if (Math.abs(fraction-fraction_map[label])<lowest) {
                      lowest = Math.abs(fraction-fraction_map[label])
                      lowest_label = label
                      if (fraction-fraction_map[label]==0) {
                          OverUnder = "About ";
                      }
                      else if (fraction-fraction_map[label]>0) {
                          OverUnder = "Just over ";
                      }
                      else if (fraction-fraction_map[label]<0) {
                          OverUnder = "Just under ";
                      } } }
              return [OverUnder, lowest_label]
          }

          let array = ['South East', 'South West', 'East', 'West Midlands', 'East Midlands', 'North East', 'North West']

          function regionThe(place) {
            let placeNew = 'empty'
            if (array.includes(place)) {
              placeNew = 'the ' + place;
            } else {
              placeNew = place;
            }
            return placeNew;
          }

          return rosaenlg_en_US.render(string, {
            language: 'en_UK',
            loc: loc,
            frac: frac,
            fracWord: get_word(frac),
            b1900: dateLookup[areacd].b1900,
            a2012: dateLookup[areacd].a2012,
            la: regionLookup[areacd].lName,
            country: regionLookup[areacd].country,
            parent: regionThe(regionLookup[areacd].rName),
            deprivation: decileEPC[regionLookup[areacd].country][regionLookup[areacd].decile],
            regionaVal: regionEPC[regionLookup[areacd].rName],
            diff: frac-regionEPC[regionLookup[areacd].rName],
            decile: regionLookup[areacd].decile
          });
        } else {
          return areanm + "<br>No data available";
        }
        pymChild.sendHeight();

      });

      d3.select("#keyvalue").html(function() {
        if (!isNaN(areaval)) {
          return areanm + "<br>" + "" + displayformat(areaval)+"%";
        } else {
          return areanm + "<br>No data available";
        }
      });
    }

    function setScreenreader(name, value) {
      if (!isNaN(value)) {
        d3.select("#screenreadertext").text("The average house price paid in " + name + " is £" + d3.format(",")(value));
      } else {
        d3.select("#screenreadertext").text("There is no data available for " + name);
      }
    }

    function hideaxisVal() {
      d3.select("#keyvalue").style("font-weight", "bold").text("");
      d3.select("#screenreadertext").text("");
    }

    function getColour(value) {
      return isNaN(value) ? dvc.nullColour : color(value);
    }

    function csv2json(csv) {
      var json = {},
        i = 0,
        len = csv.length;
      while (i < len) {
        json[csv[i][csv.columns[0]]] = +csv[i][csv.columns[1]];
        json[csv[i][csv.columns[0]]] = +csv[i][csv.columns[1]];
        i++;
      }
      return json;
    }
    pymChild.sendHeight();
  } //end function ready
  }else{
    //provide fallback for browsers that don't support webGL
    d3.select('#map').remove();
    d3.select('body').append('p').html("Unfortunately your browser does not support WebGL. <a href='https://www.gov.uk/help/browsers' target='_blank>'>If you're able to please upgrade to a modern browser</a>");
  }
})
