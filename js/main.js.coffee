class Projector
  CORRESPONDENCE: 1
  FEATURE: 2

  constructor: (@src_map, @dst_map) ->
    # Initialise transform
    @_setTransform(Matrix.I(3))

    @correspondences = []
    @features = []

    # Create dst map base layers
    osm_layer = new OpenLayers.Layer.OSM('OpenStreetMap')
    mq_layer = new OpenLayers.Layer.OSM('MapQuest', [
      "http://otile1.mqcdn.com/tiles/1.0.0/osm/${z}/${x}/${y}.jpg",
      "http://otile2.mqcdn.com/tiles/1.0.0/osm/${z}/${x}/${y}.jpg",
      "http://otile3.mqcdn.com/tiles/1.0.0/osm/${z}/${x}/${y}.jpg",
      "http://otile4.mqcdn.com/tiles/1.0.0/osm/${z}/${x}/${y}.jpg",
    ])
    aerial_layer = new OpenLayers.Layer.Bing({
      name: 'Aerial', type: 'AerialWithLabels', culture: 'en-GB',
      key: 'AvsuiJVtmn-zxz7hjF_DnAI7PGecNnzJFsNi7V69yd0BUdWYNlyetZblBtnRUcEI',
    })

    # Create vector layers
    styleMap = new OpenLayers.StyleMap(@_createStyle())
    @dst_vectors = new OpenLayers.Layer.Vector('Points', styleMap: styleMap, displayInLayerSwitcher: false)
    @src_vectors = new OpenLayers.Layer.Vector('Points', styleMap: styleMap, displayInLayerSwitcher: false)

    # Add layers to dest map
    @dst_map.addLayers([ aerial_layer, mq_layer, osm_layer, @dst_vectors ])
    @dst_map.setBaseLayer(aerial_layer)

    # Add layers to src map
    @src_map.addLayer(@src_vectors)

    # Set default dest map extent
    @setCenterLonLat(0.119, 52.205, false)

    # Add controls to dest map
    @dst_map.addControls([
      new OpenLayers.Control.LayerSwitcher
      new OpenLayers.Control.DragFeature(@dst_vectors,
        autoActivate: true
        onDrag: (f) =>
          switch f.attributes.type
            when @CORRESPONDENCE
              @_calculateHomographyTransform()
              @_updateDestFeatures()
            when @FEATURE
              @_updateSrcFeatures()
      )
    ])

    # Create the source controls
    @src_controls = {
      drag: new OpenLayers.Control.DragFeature(@src_vectors,
        onDrag: (f) =>
          @_calculateHomographyTransform() if f.attributes.type == @CORRESPONDENCE
          @_updateDestFeatures()
      ),
      add_corr: new OpenLayers.Control.DrawFeature(
        @src_vectors, OpenLayers.Handler.Point,
        callbacks: {
          create: (p,f) =>
            f.attributes.type = @CORRESPONDENCE
            f.attributes.label = @correspondences.length + 1
          done: (p) =>
            fo = { type: @CORRESPONDENCE, label: @correspondences.length + 1 }

            f = new OpenLayers.Feature.Vector(p, fo)
            fp = new OpenLayers.Feature.Vector(@_transformSourceToDest(p), fo)

            @src_vectors.addFeatures(f)
            @dst_vectors.addFeatures(fp)

            @correspondences.push({ src: f, dst: fp })

            @_calculateHomographyTransform()
            @_updateDestFeatures()
        }
      ),
      add_poi: new OpenLayers.Control.DrawFeature(
        @src_vectors, OpenLayers.Handler.Point,
        callbacks: {
          create: (p,f) =>
            f.attributes.type = @FEATURE
            f.attributes.label = @features.length + 1
          done: (p) =>
            fo = { type: @FEATURE, label: @features.length + 1 }

            f = new OpenLayers.Feature.Vector(p, fo)
            fp = new OpenLayers.Feature.Vector(@_transformSourceToDest(p), fo)

            @src_vectors.addFeatures(f)
            @dst_vectors.addFeatures(fp)

            @features.push({ src: f, dst: fp })
        }
      ),
    }

    for own _, control of @src_controls
      @src_map.addControl(control)

    # For the moment there is no source layer
    @src_img_layer = null

    # Create hidden image for setSourceImage
    @hidden_img = $('<img>').css('display', 'none')
    @hidden_img.load => @_sourceImageLoaded()
    $('body').append(@hidden_img)

  setSourceImage: (img_url) ->
    @hidden_img.attr('src', img_url)

  setCenterLonLat: (lon, lat, reset_transform = true) ->
    proj = new OpenLayers.Projection("EPSG:4326")
    point = new OpenLayers.LonLat(lon, lat)
    point.transform(proj, @dst_map.getProjectionObject())
    @dst_map.setCenter(point, 16)
    if reset_transform
      @resetTransform()

  setMoveMode: -> @_activateControl('drag')

  setAddCorrespondenceMode: -> @_activateControl('add_corr')

  setAddPOIMode: -> @_activateControl('add_poi')

  _sourceImageLoaded: ->
    # Get image information from tag
    img_url = @hidden_img.attr('src')
    w = @hidden_img.width()
    h = @hidden_img.height()

    @src_map.removeLayer(@src_img_layer) if @src_img_layer

    @src_img_layer = new OpenLayers.Layer.Image(
      'Source', img_url,
      new OpenLayers.Bounds(0, 0, w, h), new OpenLayers.Size(w,h),
      {
        numZoomLevels: 5,
        maxResolution: 3,
      }
    )
    
    @src_map.addLayer(@src_img_layer)
    @src_map.setCenter([0.5*w, 0.5*h], 1)

    @resetTransform()
    @setMoveMode()
    @correspondences = []
    @features = []
    @src_vectors.removeAllFeatures()
    @dst_vectors.removeAllFeatures()

  resetTransform: ->
    @_setTransformFromBounds(@src_map.getExtent(), @dst_map.getExtent())

    for c in [].concat(@correspondences).concat(@features)
      p = @_transformSourceToDest(c.src.geometry)
      @dst_vectors.removeFeatures(c.dst)
      c.dst.geometry = p
      @dst_vectors.addFeatures(c.dst)

  _setTransform: (t) ->
    @_transform = t
    @_inv_transform = t.inv()

  _setTransformFromBounds: (source_bounds, dest_bounds) ->
    sx = source_bounds.left
    sy = source_bounds.top
    sw = source_bounds.getWidth()
    sh = source_bounds.getHeight()
    dx = dest_bounds.left
    dy = dest_bounds.top
    dw = dest_bounds.getWidth()
    dh = dest_bounds.getHeight()

    # transform is x' = (x - source_origin_x) * dest_width / source_width + dest_origin_x
    #                 = x * (dw / sw) + (dx - sx * (dw / sw))
    # and similar for y'

    @_setTransform($M([
        [ dw/sw, 0, dx - sx * (dw/sw) ],
        [ 0, dh/sh, dy - sy * (dh/sh) ],
        [ 0, 0, 1 ],
    ]))

  _transformSourceToDest: (p) ->
    v = $V([p.x, p.y, 1])
    v_prime = @_transform.multiply(v)
    p_prime = new OpenLayers.Geometry.Point(v_prime.e(1)/v_prime.e(3), v_prime.e(2)/v_prime.e(3))
    return p_prime

  _transformDestToSource: (p) ->
    v = $V([p.x, p.y, 1])
    v_prime = @_inv_transform.multiply(v)
    p_prime = new OpenLayers.Geometry.Point(v_prime.e(1)/v_prime.e(3), v_prime.e(2)/v_prime.e(3))
    return p_prime

  _calculateHomographyTransform: ->
    if @correspondences.length < 3
      return

    A = []
    for c in @correspondences
      f = c.src
      p = f.geometry

      f_prime = c.dst
      p_prime = f_prime.geometry

      A.push([ 0, 0, 0, -p.x, -p.y, -1, p_prime.y * p.x, p_prime.y * p.y, p_prime.y ])
      A.push([ p.x, p.y, 1, 0, 0, 0, -p_prime.x * p.x, -p_prime.x * p.y, -p_prime.x ])
      A.push([ -p_prime.y * p.x, -p_prime.y * p.y, -p_prime.y, p_prime.x * p.x, p_prime.x * p.y, p_prime.x, 0, 0, 0 ])

    out = numeric.svd(A)
    v = out.V
    H = $M([
        [ v[0][8], v[1][8], v[2][8] ],
        [ v[3][8], v[4][8], v[5][8] ],
        [ v[6][8], v[7][8], v[8][8] ],
    ])

    @_setTransform(H)

  _updateDestFeatures: ->
    for c in @features
      p = @_transformSourceToDest(c.src.geometry)
      @dst_vectors.removeFeatures(c.dst)
      c.dst.geometry = p
      @dst_vectors.addFeatures(c.dst)

  _updateSrcFeatures: ->
    for c in @features
      p = @_transformDestToSource(c.dst.geometry)
      @src_vectors.removeFeatures(c.src)
      c.src.geometry = p
      @src_vectors.addFeatures(c.src)

  _activateControl: (control_key) ->
    for own key, control of @src_controls
      if key == control_key
        control.activate()
      else
        control.deactivate()

  _createStyle: ->
    style = new OpenLayers.Style

    rule_corr = new OpenLayers.Rule({
      filter: new OpenLayers.Filter.Comparison({
        type: OpenLayers.Filter.Comparison.EQUAL_TO,
        property: 'type',
        value: @CORRESPONDENCE,
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
    })

    rule_test_pit = new OpenLayers.Rule({
      filter: new OpenLayers.Filter.Comparison({
        type: OpenLayers.Filter.Comparison.EQUAL_TO,
        property: 'type',
        value: @FEATURE,
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
    })

    style.addRules([rule_corr, rule_test_pit])

    return style

class GeoSearch
  constructor: ->
    # A cache for query -> results
    @sw_cache = { }
    @q_cache = { }

  search: (query, process) ->
    return null if !query || query.length < 1

    return process(@q_cache[query]) if @q_cache[query]

    q = $.param({
      username: 'rjw57',
      q: query,
      featureClass: 'P',
      maxRows: 8,
    }, true)

    $.getJSON('http://api.geonames.org/searchJSON?' + q, (results) =>
      r = results.geonames[0] if results.geonames && results.geonames[0]
      @q_cache[query] = r
      process(r)
    )

  startsWith: (query, process) ->
    return process(@sw_cache[query]) if @sw_cache[query]

    q = $.param({
      username: 'rjw57',
      name_startsWith: query,
      orderby: 'relevance',
      featureClass: 'P',
      maxRows: 8,
    }, true)

    $.getJSON('http://api.geonames.org/searchJSON?' + q, (results) =>
      @sw_cache[query] = results if results
      process(results)
    )

class Application
  constructor: ->
    # Create the source and destination maps
    src_map = new OpenLayers.Map('source')
    dst_map = new OpenLayers.Map('destination')

    # Create the logic
    @projector = new Projector(src_map, dst_map)

    # Set initial source image
    @projector.setSourceImage('Cambridge_centre_map.png')

    # Create a geoname searcher
    @geo_search = new GeoSearch

    # Set geo search typeahead
    $('.geo-search').typeahead(
      source: (p,q) => @_geoSearch(p,q),
      minLength: 3
    )
    $('#search-submit').click => @_setDestPlace($('#placename').val())
    $('#search-clear').click => $('#placename').val('')

    $('#reset').click => @projector.resetTransform()

    $.getJSON('output/places.json', (p) => @_gotPlaces(p))

    $('#move').click => @projector.setMoveMode()
    $('#add-correspondence').click => @projector.setAddCorrespondenceMode()
    $('#add-poi').click => @projector.setAddPOIMode()
    $('#move').click()

    $('#change-source').click =>
      if $('#source-image').attr('checked')
        @projector.setSourceImage($('#source-image-url').val())

      if $('#source-aca-dig').attr('checked')
        return if !@selected_place || !@selected_dig
        for resource in @selected_dig
          if /[Mm]ap/.test(resource.description)
            @projector.setSourceImage('http://www.arch.cam.ac.uk/aca/' + resource.href)
            @_setDestPlace(@selected_place.name + ', ' + @selected_place.county + ', UK')

  _setDestPlace: (placename) ->
    @geo_search.search(placename, (r) =>
      return if !r
      @projector.setCenterLonLat(r.lng, r.lat)
    )

  _gotPlaces: (places) ->
    @places = places

    place_sel = $('select[name="aca-place"]')
    dig_sel = $('select[name="aca-dig"]')

    place_sel.change =>
      # populate dig
      @selected_place = @places[place_sel.children(':selected').val()]
      dig_sel.html('')
      for own name, resources of @selected_place.digs
        dig_sel.append($('<option>').val(name).text(name))
      dig_sel.change()

    dig_sel.change =>
      @selected_dig = @selected_place.digs[dig_sel.children(':selected').val()]

    # populate place selector
    place_sel.html('')
    for place, i in places
      place_sel.append($('<option>').val(i).text(place.name + ', ' + place.county))
    place_sel.change()

  _geoSearch: (query, process) ->
    @geo_search.startsWith(query, (results) =>
      name = (r) ->
        n = [ r.name ]
        n.push(r.adminName1) if r.adminName1
        n.push(r.countryName) if r.countryName
        return n.join(', ')

      names = (name x for x in results.geonames)
      process(names)
    )

$(window).load ->
  new Application
