'use strict';

var ref = require('ref');
var StructType = require('ref-struct');
var ArrayType = require('ref-array');
var ffi = require('ffi');

module.exports = function (vips) {
    // inherit from GObject fields
    var LayoutImage = Object.assign(Object.assign({}, 
        vips.LayoutObject), {
        // opaque
    });
    var StructImage = StructType(LayoutImage);
    var StructImageP = ref.refType(StructImage);
    var ArrayDouble = ArrayType('double');
    var ArrayString = ArrayType('string');
    var SizeP = ref.refType('size_t');
    var DoubleP = ref.refType('double');

    var libglib = ffi.Library('libglib-2.0', {
        g_free: ['void', ['pointer']],
        g_strfreev: ['void', ['pointer']]
    });

    var libvips = ffi.Library('libvips', {
        vips_foreign_find_load: ['string', ['string']],
        vips_foreign_find_load_buffer: ['string', ['pointer', 'size_t']],
        vips_foreign_find_save: ['string', ['string']],
        vips_foreign_find_save_buffer: ['string', ['string']],

        vips_image_new_matrix_from_array: [StructImageP, 
            [ref.types.int, ref.types.int, ArrayDouble, ref.types.int]],
        vips_image_new_from_memory: [StructImageP, 
            ['pointer', ref.types.size_t, 
             ref.types.int, ref.types.int, ref.types.int, ref.types.int]],
        vips_image_copy_memory: [StructImageP, [StructImageP]],

        vips_image_get_typeof: [vips.GType, [StructImageP, 'string']],
        vips_image_get: [vips.GType, 
            [StructImageP, 'string', vips.StructGValueP]],
        vips_image_set: [vips.GType, 
            [StructImageP, 'string', vips.StructGValueP]],
        vips_image_remove: [ref.types.int, [StructImageP, 'string']],
        vips_image_get_fields: [ArrayString, [StructImageP]],

        vips_filename_get_filename: ['string', ['string']],
        vips_filename_get_options: ['string', ['string']],

        vips_image_new_temp_file: [StructImageP, ['string']],

        vips_image_write: [ref.types.int, [StructImageP, 'string']],
        vips_image_write_to_memory: ['pointer', [StructImageP, SizeP]],

    });

    // either a single number, or a table of numbers
    function is_pixel(x) {
        return typeof x == 'number' || Array.isArray(x); 
    }

    // test for rectangular array of something
    function is_2D(x) {
        if (!Array.isArray(x)) {
                return false;
        }

        for (let i in x) {
            if (!Array.isArray(x[i]) ||
                    x[i].length != x[0].length) {
                    return false;
            }
        }

        return true;
    }

    // apply a function to a thing, or map over a list
    // we often need to do something like (1.0 / other) and need to work for 
    // lists as well as scalars
    function smap(x, fn) {
        if (Array.isArray(x)) {
            return x.map(fn);
        }
        else {
            return fn(x);
        }
    }

    function call_enum(image, other, base, operation) {
        if (is_pixel(other)) {
            return vips.call(base + '_const', image, operation, other);
        }
        else {
            return vips.call(base, image, other, operation);
        }
    }

    /* FIXME ... add this once we have fields
     *
    def _run_cmplx(fn, image):
        """Run a complex function on a non-complex image.

        The image needs to be complex, or have an even number of bands. 
        The input can be int, the output is always float or double.
        """
        original_format = image.format

        if image.format != 'complex' and image.format != 'dpcomplex':
            if image.bands % 2 != 0:
                raise Error('not an even number of bands')

            if image.format != 'float' and image.format != 'double':
                    image = image.cast('float')

            if image.format == 'double':
                    new_format = 'dpcomplex'
            else:
                    new_format = 'complex'

            image = image.copy(format=new_format, bands=image.bands / 2)

        image = fn(image)

        if original_format != 'complex' and original_format != 'dpcomplex':
            if image.format == 'dpcomplex':
                new_format = 'double'
            else:
                new_format = 'float'

            image = image.copy(format=new_format, bands=image.bands * 2)

        return image
     */

    var Image = function (ptr) {
        vips.VipsObject.call(this, ptr);

        // this is horrible! but I don't see how to add these to the prototype:
        // we lose "this" for proto properties
        [
            'width',
            'height',
            'bands',
            'format',
            'interpretation',
            'xres',
            'yres',
            'xoffset',
            'yoffset',
            'filename'
        ].forEach((name) => {
            Object.defineProperty(this, name, {
                get: () => {
                    return this.get(name);
                }
            });
        });

        // scale and offset have default values
        [
            ['scale', 1.0], 
            ['offset', 0.0] 
        ].forEach((x) => {
            var name = x[0];
            var default_value = x[1];

            Object.defineProperty(this, name, {
                get: () => {
                    if (this.get_typeof(name) == 0) {
                        return default_value;
                    }
                    else {
                        return this.get(name);
                    }
                }
            });
        });
    }

    Image.prototype = Object.create(vips.VipsObject.prototype);
    Image.prototype.constructor = Image;

    Image.imageize = function (match_image, value) {
        /* FIXME ... need new_from*() first
         *
                # careful! self can be None if value is a 2D array
                if isinstance(value, Image):
                        return value
                elif _is_2D(value):
                        return Image.new_from_array(value)
                else:
                        return self.new_from_image(value)
         */

        return value;
    }

    // constructors

    Image.new_from_file = function (vips_filename, options) {
        options = typeof options !== 'undefined' ? options : {};
        options = Object.assign({}, options)

        var filename = libvips.vips_filename_get_filename(vips_filename);
        var string_options = libvips.vips_filename_get_options(vips_filename);
        var name = libvips.vips_foreign_find_load(filename);
        if (name == ref.NULL) {
            throw new Error('unable to load from file ' + vips_filename);
        }
        options.string_options = string_options;

        return vips.call(name, filename, options);
    }

    Image.new_from_array = function (array, scale, offset) {
        scale = typeof scale !== 'undefined' ? scale : 1.0;
        offset = typeof offset !== 'undefined' ? offset : 0.0;

        if (!is_2D(array)) {
            array = [array];
        }

        var height = array.length;
        var width = array[0].length;
        var n = width * height;
        var a = new ArrayDouble(n);

        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                a[x + y * width] = array[y][x]
            }
        }

        var vi = libvips.vips_image_new_matrix_from_array(width, height, a, n);
        if (vi == ref.NULL) {
            throw new Error('unable to make image from matrix')
        }
        var image = new Image(vi);

        image.set_typeof(vips.GTYPES.gdouble, 'scale', scale);
        image.set_typeof(vips.GTYPES.gdouble, 'offset', offset);

        return image;
    }

    Image.prototype.new_from_image = function (value) {
        var pixel = Image.black(1, 1).add(value).cast(this.format);
        var image = pixel.embed(0, 0, this.width, this.height,
            {extend: 'copy'});
        image = image.copy({
            interpretation: this.interpretation,
            xres: this.xres,
            yres: this.yres,
            xoffset: this.xoffset,
            yoffset: this.yoffset
        });

        return image
    }

    // writers

    Image.prototype.write_to_file = function (vips_filename, options) {
        options = typeof options !== 'undefined' ? options : {};
        options = Object.assign({}, options)

        var filename = libvips.vips_filename_get_filename(vips_filename);
        var string_options = libvips.vips_filename_get_options(vips_filename);
        var name = libvips.vips_foreign_find_save(filename);
        if (name == ref.NULL) {
            throw new Error('unable to write to file ' + vips_filename);
        }
        options.string_options = string_options;

        return vips.call(name, this, filename, options);
    }

    // get/set metadata

    Image.prototype.get_typeof = function (field) {
        // before libvips 8.5, property types must be fetched separately,
        // since built-in enums were reported as ints
        if (!vips.at_least_libvips(8, 5)) {
            var gtype = vips.VipsObject.prototype.get_typeof.call(this, field);
            if (gtype != 0) {
                return gtype;
            }
        }

        return libvips.vips_image_get_typeof(this.buffer, field);
    }

    Image.prototype.get = function (field) {
        if (!vips.at_least_libvips(8, 5)) {
            var gtype = vips.VipsObject.prototype.get_typeof.call(this, field);
            if (gtype != 0) {
                return vips.VipsObject.prototype.get.call(this, field);
            }
        }

        var gv = new vips.GValue();
        var result = libvips.vips_image_get(this.buffer, field, gv.buffer.ref());
        if (result != 0) { 
            throw new Error('unable to get ' + field);
        }

        return gv.get();
    }

    Image.prototype.get_fields = function () {
        var ptr = libvips.vips_image_get_fields(this.buffer);

        // it's terminated by a NULL pointer .. search for the end
        var array = ArrayString.untilZeros(ptr.buffer);

        var names = [];
        for (var i = 0; i < array.length; i++) {
            // will this copy the string, or share a pointer? no idea
            names.push(array[i]);
        }
        libglib.g_strfreev(ptr.buffer);

        return names;
    }

    Image.prototype.set_typeof = function (gtype, field, value) {
        var gv = new vips.GValue();
        gv.init(gtype);
        gv.set(value);
        libvips.vips_image_set(this.buffer, field, gv.buffer.ref());
    }

    Image.prototype.set = function (field, value) {
        this.set_typeof(this.get_typeof(field), field, value);
    }

    Image.prototype.remove = function (field) {
        libvips.vips_image_remove(this.buffer, field);
    }

    // members

    Image.black = function (width, height, options) {
        options = typeof options !== 'undefined' ? options : {};

        return vips.call('black', width, height, options);
    }

    Image.prototype.embed = function (left, top, width, height, options) {
        options = typeof options !== 'undefined' ? options : {};

        return vips.call('embed', this, left, top, width, height, options);
    }

    Image.prototype.add = function (value, options) {
        options = typeof options !== 'undefined' ? options : {};

        if (value instanceof Image) {
            return vips.call('add', this, value, options);
        }
        else {
            return vips.call('linear', this, 1, value, options);
        }
    }

    Image.prototype.cast = function (format, options) {
        options = typeof options !== 'undefined' ? options : {};

        return vips.call('cast', this, format, options);
    }

    Image.prototype.copy = function (options) {
        options = typeof options !== 'undefined' ? options : {};

        return vips.call('copy', this, options);
    }

    Image.prototype.avg = function (options) {
        options = typeof options !== 'undefined' ? options : {};

        return vips.call('avg', this, options);
    }

    vips.Image = Image;
};
