# videojs-xr

This is a plugin for using WebXR with [videojs](https://github.com/videojs), based on [videojs-vr](https://github.com/videojs/videojs-vr). Videojs-xr supports the Oculus browser and Firefox Reality on Oculus Quest. For a jump start how to use it with videojs see the [index.html](https://github.com/thomasdeppisch/videojs-xr/blob/master/index.html).
You can see it in action [here](https://thomasdeppisch.github.io/videojs-xr/index.html). This plugin is used in [HOAST360](https://github.com/thomasdeppisch/hoast360) and in the [HOAST library](https://hoast.iem.at/).

Currently the only supported video format is 360° equirectangular.

## Installation

```sh
npm install --save videojs-xr
```

## Usage

To include videojs-xr on your website or web application, use any of the following methods.

### `<script>` Tag

This is the simplest case. Get the script in whatever way you prefer and include the plugin _after_ you include [video.js][videojs], so that the `videojs` global is available.

```html
<script src="//path/to/video.min.js"></script>
<script src="//path/to/videojs-xr.min.js"></script>
<script>
  var player = videojs('my-video');

  player.xr();
</script>
```

### Browserify/CommonJS

When using with Browserify, install videojs-xr via npm and `require` the plugin as you would any other module.

```js
var videojs = require('video.js');

// The actual plugin function is exported by this module, but it is also
// attached to the `Player.prototype`; so, there is no need to assign it
// to a variable.
require('videojs-xr');

var player = videojs('my-video');

player.xr();
```

### RequireJS/AMD

When using with RequireJS (or another AMD library), get the script in whatever way you prefer and `require` the plugin as you normally would:

```js
require(['video.js', 'videojs-xr'], function(videojs) {
  var player = videojs('my-video');

  player.xr();
});
```

## License

MIT. Copyright (c) Thomas Deppisch


[videojs]: http://videojs.com/
