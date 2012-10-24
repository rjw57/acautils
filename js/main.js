viewer = (function() {
  var CORRESPONDENCE=1, TEST_PIT=2;
  var self = {};

  var style = new OpenLayers.Style();

  var rule_corr = new OpenLayers.Rule({
    filter: new OpenLayers.Filter.Comparison({
      type: OpenLayers.Filter.Comparison.EQUAL_TO,
      property: 'type',
      value: CORRESPONDENCE,
    }),
    symbolizer: {
      pointRadius: 10,
      fillColor: '#00dd00',
      fillOpacity: 0.75,
      label: '${label}',
      strokeColor: '#008800',
      labelOutlineWidth: 0,
      fontSize: '12px',
    },
  });

  var rule_test_pit = new OpenLayers.Rule({
    filter: new OpenLayers.Filter.Comparison({
      type: OpenLayers.Filter.Comparison.EQUAL_TO,
      property: 'type',
      value: TEST_PIT,
    }),
    symbolizer: {
      pointRadius: 10,
      fillColor: '#dddd00',
      fillOpacity: 0.75,
      label: '${label}',
      strokeColor: '#888800',
      labelOutlineWidth: 0,
      fontSize: '12px',
    },
  });

  style.addRules([rule_corr, rule_test_pit]);
  
  self._osm_layer = new OpenLayers.Layer.OSM('Base');
  self._source_layer = null;
  self._source_vectors = new OpenLayers.Layer.Vector('Vector Layer', { styleMap: new OpenLayers.StyleMap(style) });
  self._base_vectors = new OpenLayers.Layer.Vector('Vector Layer', { styleMap: new OpenLayers.StyleMap(style) });

  self._set_transform = function(t) {
    self._transform = t;
    self._inv_transform = t.inv();
  }

  // the projective map between source co-ordinates (pixels) to destination co-ordinates (long-lat)
  self._set_transform(Matrix.I(3));

  self._initialise_transform = function(source_bounds, dest_bounds) {
    var sx = source_bounds.left, sy = source_bounds.top;
    var sw = source_bounds.getWidth(), sh = source_bounds.getHeight();
    var dx = dest_bounds.left, dy = dest_bounds.top;
    var dw = dest_bounds.getWidth(), dh = dest_bounds.getHeight();

    // transform is x' = (x - source_origin_x) * dest_width / source_width + dest_origin_x
    //                 = x * (dw / sw) + (dx - sx * (dw / sw))
    // and similar for y'

    self._set_transform($M([
        [ dw/sw, 0, dx - sx * (dw/sw) ],
        [ 0, dh/sh, dy - sy * (dh/sh) ],
        [ 0, 0, 1 ],
    ]));
  }

  self._transform_point = function(p, inv) {
      var v = $V([p.x, p.y, 1]);
      var v_prime = inv ? self._inv_transform.multiply(v) : self._transform.multiply(v);
      var p_prime = new OpenLayers.Geometry.Point(v_prime.e(1)/v_prime.e(3), v_prime.e(2)/v_prime.e(3));
      return p_prime;
  }

  self._update_homography = function() {
    var source_cor = self._source_correspondences();
    if(source_cor.length < 3) {
      return;
    }

    var A = [];
    for(var idx=0; idx < source_cor.length; ++idx) {
      var f = source_cor[idx];
      var f_prime = f.attributes.other;
      var p = f.geometry;
      var p_prime = f_prime.geometry;

      A.push([ 0, 0, 0, -p.x, -p.y, -1, p_prime.y * p.x, p_prime.y * p.y, p_prime.y ]);
      A.push([ p.x, p.y, 1, 0, 0, 0, -p_prime.x * p.x, -p_prime.x * p.y, -p_prime.x ]);
      A.push([ -p_prime.y * p.x, -p_prime.y * p.y, -p_prime.y, p_prime.x * p.x, p_prime.x * p.y, p_prime.x, 0, 0, 0 ]);
    }

    var out = numeric.svd(A);
    var v = out.V;
    var H = $M([
        [ v[0][8], v[1][8], v[2][8] ],
        [ v[3][8], v[4][8], v[5][8] ],
        [ v[6][8], v[7][8], v[8][8] ],
    ]).multiply(1.0/v[8][8]);

    self._set_transform(H);
  }

  self._reapply_transform = function(from_src_to_dst) {
    var pits = self._source_test_pits();
    for(var idx in pits) {
      var src_pit = pits[idx];
      var dst_pit = src_pit.attributes.other;

      if(from_src_to_dst) {
        var new_p = self._transform_point(src_pit.geometry);
        dst_pit.geometry.x = new_p.x;
        dst_pit.geometry.y = new_p.y;
        self._base_vectors.drawFeature(dst_pit);
      } else {
        var new_p = self._transform_point(dst_pit.geometry, true);
        src_pit.geometry.x = new_p.x;
        src_pit.geometry.y = new_p.y;
        self._source_vectors.drawFeature(src_pit);
      }
    }
  }

  // FORM CONTROL CHANGES
  self._dig_change = function() {
    var idx, resource;

    self._current_dig = self._current_place.digs[self._dig_sel.children(':selected').val()];
    for(idx in self._current_dig) {
      resource = self._current_dig[idx];
      if(/[Mm]ap/.test(resource.description)) {
        var w = resource.size[0], h = resource.size[1];
        if(self._source_layer) {
          self.source_map.removeLayer(self._source_layer);
        }
        self._source_layer = new OpenLayers.Layer.Image(
          resource.description, 'http://www.arch.cam.ac.uk/aca/' + resource.href,
          new OpenLayers.Bounds(0, 0, w, h),
          new OpenLayers.Size(w, h),
          {
            numZoomLevels: 3,
            maxResolution: 2,
          });
        self.source_map.addLayer(self._source_layer);
        self.source_map.setCenter([0.5*resource.size[0], 0.5*resource.size[1]], 0);
        self._initialise_transform(self.source_map.getExtent(), self.base_map.getExtent());
      }
    }
    self._source_vectors.removeAllFeatures();
  }

  self._location_change = function() {
    var key, opt;

    self._current_place = self._places[self._location_sel.children(':selected').val()];

    center = new OpenLayers.LonLat(self._current_place.latlng[1], self._current_place.latlng[0]);
    center.transform(new OpenLayers.Projection('EPSG:4326'), self.base_map.getProjectionObject());
    self.base_map.setCenter(center, 15);

    // populate digs
    self._dig_sel.html('');
    for(var key in self._current_place.digs) {
      opt = $('<option>').attr('value', key).text(key);
      self._dig_sel.append(opt);
    }
    self._dig_sel.change();
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

    self.base_map = new OpenLayers.Map('base_map', { layers: [ self._osm_layer, self._base_vectors ], });
    self.base_map.zoomToMaxExtent();
    self.source_map = new OpenLayers.Map('source_map', { layers: [ self._source_vectors, ], });
  }

  self._source_correspondences = function() {
    var out = [];
    for(var idx in self._source_vectors.features) {
      var f = self._source_vectors.features[idx];
      var attr = f.attributes;
      if(attr.type && (attr.type == CORRESPONDENCE)) {
        out.push(f);
      }
    }
    return out;
  }

  self._source_test_pits = function() {
    var out = [];
    for(var idx in self._source_vectors.features) {
      var f = self._source_vectors.features[idx];
      var attr = f.attributes;
      if(attr.type && (attr.type == TEST_PIT)) {
        out.push(f);
      }
    }
    return out;
  }

  self.go = function() {
    self._setup();

    self._controls = {
      'correspondenceToggle': new OpenLayers.Control.DrawFeature(
          self._source_vectors, OpenLayers.Handler.Point, {
            callbacks: {
              create: function(p,f) {
                f.attributes.type = CORRESPONDENCE;
                f.attributes.label = self._source_correspondences().length + 1;
              },
              done: function(p) {
                var f = new OpenLayers.Feature.Vector(p, {
                  type: CORRESPONDENCE,
                  label: self._source_correspondences().length + 1,
                });

                var p_prime = self._transform_point(p);
                var f_prime = new OpenLayers.Feature.Vector(p_prime, {
                  type: CORRESPONDENCE,
                  label: self._source_correspondences().length + 1,
                });

                f.attributes.other = f_prime;
                f_prime.attributes.other = f;

                self._source_vectors.addFeatures(f);
                self._base_vectors.addFeatures(f_prime);

                self._update_homography();
                self._reapply_transform(true);
              }
            }
          }),
      'testPitToggle': new OpenLayers.Control.DrawFeature(
          self._source_vectors, OpenLayers.Handler.Point, {
            callbacks: {
              create: function(p,f) {
                f.attributes.type = TEST_PIT;
                f.attributes.label = self._source_test_pits().length + 1;
              },
              done: function(p) {
                var f = new OpenLayers.Feature.Vector(p, {
                  type: TEST_PIT,
                  label: self._source_test_pits().length + 1,
                });

                var p_prime = self._transform_point(p);
                var f_prime = new OpenLayers.Feature.Vector(p_prime, {
                  type: TEST_PIT,
                  label: self._source_test_pits().length + 1,
                });

                f.attributes.other = f_prime;
                f_prime.attributes.other = f;

                self._source_vectors.addFeatures(f);
                self._base_vectors.addFeatures(f_prime);
              }
            }
          }),
      'dragToggle': new OpenLayers.Control.DragFeature(self._source_vectors, {
        onComplete: function() { self._update_homography(); self._reapply_transform(true); },
        onDrag: function(f) {
          var other = f.attributes.other;
          if(!other) {
            return;
          }

          if(f.attributes.type != CORRESPONDENCE) {
            var new_p = self._transform_point(f.geometry);
            other.geometry.x = new_p.x;
            other.geometry.y = new_p.y;
            self._base_vectors.drawFeature(other);
          } else {
            self._update_homography();
            self._reapply_transform(true);
          }
        },
      }),
    };

    for(var key in self._controls) {
      self.source_map.addControl(self._controls[key]);
    }

    self._base_controls = {
      drag: new OpenLayers.Control.DragFeature(self._base_vectors, {
        onComplete: function() { self._update_homography(); self._reapply_transform(true); },
        onDrag: function(f) {
          var other = f.attributes.other;
          if(!other) {
            return;
          }

          if(f.attributes.type != CORRESPONDENCE) {
            var new_p = self._transform_point(f.geometry, true);
            other.geometry.x = new_p.x;
            other.geometry.y = new_p.y;
            self._source_vectors.drawFeature(other);
          } else {
            self._update_homography();
            self._reapply_transform(true);
          }
        },
      }),
    };

    for(var key in self._base_controls) {
      self.base_map.addControl(self._base_controls[key]);
    }
    self._base_controls.drag.activate();

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
