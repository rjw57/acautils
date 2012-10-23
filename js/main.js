viewer = (function() {
  var CORRESPONDENCE=1;
  var self = {};

  var style = new OpenLayers.Style({
      fillColor: "#ff0000",
      strokeColor: "#880000",
      strokeWidth: 2,
      label: "${label}",
      fontColor: "#333333",
      fontFamily: "sans-serif",
      pointRadius: 7,
  }, {
    context: {
      label: function(feature) {
        if(!feature.attributes.label) {
          return '';
        }
        return feature.attributes.label;
      }
    },
  });
  
  self._osm_layer = new OpenLayers.Layer.OSM('Base');
  self._align_layer = null;
  self._align_vectors = new OpenLayers.Layer.Vector('Vector Layer', { styleMap: new OpenLayers.StyleMap(style) });

  // FORM CONTROL CHANGES
  self._dig_change = function() {
    var idx, resource;

    self._current_dig = self._current_place.digs[self._dig_sel.children(':selected').val()];
    for(idx in self._current_dig) {
      resource = self._current_dig[idx];
      if(/[Mm]ap/.test(resource.description)) {
        if(self._align_layer) {
          self.align_map.removeLayer(self._align_layer);
        }
        self._align_layer = new OpenLayers.Layer.Image(
          resource.description, 'cache/' + resource.href,
          new OpenLayers.Bounds(-resource.size[0], -resource.size[1], 2*resource.size[0], 2*resource.size[1]),
          new OpenLayers.Size(0.5*resource.size[0], 0.5*resource.size[1]),
          {numZoomLevels: 3});
        self.align_map.addLayer(self._align_layer);
        self.align_map.setCenter([0.5*resource.size[0], 0.5*resource.size[1]], 0);
      }
    }
    self._align_vectors.removeAllFeatures();
  }

  self._location_change = function() {
    var key, opt;

    self._current_place = self._places[self._location_sel.children(':selected').val()];

    // populate digs
    self._dig_sel.html('');
    for(var key in self._current_place.digs) {
      opt = $('<option>').attr('value', key).text(key);
      self._dig_sel.append(opt);
    }
    self._dig_sel.change();

    center = new OpenLayers.LonLat(self._current_place.latlng[1], self._current_place.latlng[0]);
    center.transform(new OpenLayers.Projection('EPSG:4326'), self.base_map.getProjectionObject());
    self.base_map.setCenter(center, 15);
  }

  // UPDATED PLACE INFORMATION
  self._load_places = function(data) {
    var place, opt, i;
    var center;
    self._places = data;

    // populate locations
    self._location_sel.html('');
    for(i in self._places) {
      place = self._places[i];
      opt = $('<option>').attr('value', i).text(place.name + ', ' + place.county);
      self._location_sel.append(opt);
    }
    self._location_sel.change();
  }

  self._setup = function() {
    self._location_sel = $('#location');
    self._dig_sel = $('#dig');

    self._location_sel.change(self._location_change);
    self._dig_sel.change(self._dig_change);

    self.base_map = new OpenLayers.Map('base_map', { layers: [ self._osm_layer, ], });
    self.base_map.zoomToMaxExtent();
    self.align_map = new OpenLayers.Map('align_map', { layers: [ self._align_vectors, ], });
  }

  self._align_correspondences = function() {
    var out = [];
    for(var idx in self._align_vectors.features) {
      var f = self._align_vectors.features[idx];
      var attr = f.attributes;
      if(attr.type && (attr.type == CORRESPONDENCE)) {
        out.push(f);
      }
    }
    return out;
  }

  self.go = function() {
    self._setup();

    self._controls = {
      'correspondenceToggle': new OpenLayers.Control.DrawFeature(
          self._align_vectors, OpenLayers.Handler.Point, {
            callbacks: {
              create: function(p,f) {
                f.attributes.type = CORRESPONDENCE;
                f.attributes.label = self._align_correspondences().length + 1;
              },
            }
          }),
      'dragToggle': new OpenLayers.Control.DragFeature(self._align_vectors),
    };

    for(var key in self._controls) {
      self.align_map.addControl(self._controls[key]);
    }

    $('input[name="type"]').change(function() {
      var id = $(this).attr('id');
      for(var key in self._controls) {
        var control = self._controls[key];
        if(key == id) {
          control.activate();
        } else {
          control.deactivate();
        }
      }
    });

    $.getJSON('output/places.json', self._load_places);
  }

  return self;
})();

$(document).ready(viewer.go);

// vim:sw=2:sts=2:et
