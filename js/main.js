viewer = (function() {
  var map, places, place_name_sel, dig_sel, map_img;

  function _resize() {
    var x = $('#x_offset').attr('value');
    var y = $('#y_offset').attr('value');
    var w = $('#width').attr('value');
    var h = $('#height').attr('value');
    map_img.css('width', w + '%');
    map_img.css('height', h + '%');
    map_img.css('left', $('#map').width() * x / 100);
    map_img.css('top', $('#map').height() * y / 100);
  }

  function _selected_place() {
    var current_place = places[$('#place_name :selected').attr('value')];
    if(current_place.latlng && current_place.latlng[0]) {
      map.setView(current_place.latlng, 13);
    }

    // populate digs
    dig_sel.html('');
    for(var name in current_place.digs) {
      var opt = $('<option>');
      opt.attr('value', name);
      opt.text(name);
      dig_sel.append(opt);
    }
    dig_sel.change();
  }

  function _selected_dig() {
    var current_place = places[$('#place_name :selected').attr('value')];
    var current_dig = current_place.digs[$('#dig :selected').attr('value')];

    for(var i in current_dig) {
      var resource = current_dig[i];
      if(resource.description.match(/Map/)) {
        var sm = $('#source_map');
        sm.html('');

        map_img = $('<img>');
        map_img.attr('src', 'cache/' + resource.href);
        sm.append(map_img);
        _resize();
      }
    }
  }

  function _got_places() {
    // populate place selector
    place_name_sel.html('');
    for(var i in places) {
      place = places[i];
      opt = $('<option>');
      opt.attr('value', i);
      opt.text(place.name + ', ' + place.county);
      place_name_sel.append(opt);
    }
    place_name_sel.change();
  }

  this.go = function() {
    map = L.map('map').setView([51.505, -0.09], 13);
    place_name_sel = $('#place_name');
    dig_sel = $('#dig');

    L.tileLayer('http://otile1.mqcdn.com/tiles/1.0.0/osm/{z}/{x}/{y}.png', {
      attribution: 'MapQuest',
    }).addTo(map);

    place_name_sel.change(_selected_place);
    dig_sel.change(_selected_dig);

    $.getJSON('output/places.json', function(data) { places = data; _got_places(); });

    $('#x_offset').change(_resize);
    $('#y_offset').change(_resize);
    $('#width').change(_resize);
    $('#height').change(_resize);
  }

  return this;
}).call();

$(document).ready(viewer.go);

// vim:sw=2:sts=2:et
