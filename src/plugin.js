import videojs from 'video.js';
import { version as VERSION } from '../package.json';
import 'babel-polyfill';
import WebXRPolyfill from 'webxr-polyfill';
import * as THREE from 'three';
import OrbitOrientationControls from './orbit-orientation-controls.js';
import CanvasPlayerControls from './canvas-player-controls';
import './big-vr-play-button';
import './cardboard-button';

const Plugin = videojs.getPlugin('plugin');

// Default options for the plugin.
const defaults = {};

class Xr extends Plugin {

    /**
     * Create a Xr plugin instance.
     *
     * @param  {Player} player
     *         A Video.js Player instance.
     *
     * @param  {Object} [options]
     *         An optional options object.
     *
     *         While not a core part of the Video.js plugin architecture, a
     *         second argument of options is a convenient way to accept inputs
     *         from your plugin's caller.
     */
    constructor(player, options) {
        // the parent class will add player under this.player
        super(player);

        this.options = videojs.mergeOptions(defaults, options);
        this.bigPlayButtonIndex_ = player.children().indexOf(player.getChild('BigPlayButton')) || 0;

        if (!navigator.xr)
            this.polyfill_ = new WebXRPolyfill();

        this.handleVrDisplayActivate_ = videojs.bind(this, this.handleVrDisplayActivate_);
        this.handleVrDisplayDeactivate_ = videojs.bind(this, this.handleVrDisplayDeactivate_);
        this.onXRSessionEnd_ = videojs.bind(this, this.onXRSessionEnd_);
        this.handleResize_ = videojs.bind(this, this.handleResize_);
        this.animate_ = videojs.bind(this, this.animate_);
        this.currentSession = null;

        this.on(player, 'loadedmetadata', this.init);

        this.player.ready(() => {
            this.player.addClass('vjs-xr');
        });
    }

    handleVrDisplayActivate_() {
        if (!this.xrSupported)
            return;

        var self = this;
        var sessionInit = { optionalFeatures: ['local-floor'] };
        navigator.xr.requestSession('immersive-vr', sessionInit).then(function (session) {
            self.renderer.xr.setSession(session);
            session.addEventListener('end', self.onXRSessionEnd_);
            self.xrActive = true;
            self.currentSession = session;
            session.requestReferenceSpace('local')
            .then((referenceSpace) => {
                self.xrReferenceSpace = referenceSpace;
            })
            self.controls3d.disable();
            self.trigger('xrSessionActivated');
            self.animationFrameId_ = self.requestAnimationFrame(self.animate_);
        });
    }

    handleVrDisplayDeactivate_() {
        this.currentSession.end();
    }

    onXRSessionEnd_() {
        if (this.animationFrameId_) {
            this.currentSession.cancelAnimationFrame(this.animationFrameId_);
            this.animationFrameId_ = 0;
        }
        this.currentSession = null;
        this.xrActive = false;
        this.controls3d.enable();
        this.trigger('xrSessionDeactivated');
        this.animationFrameId_ = this.requestAnimationFrame(this.animate_);
    }

    requestAnimationFrame(fn) {
        if (this.xrActive)
            return this.currentSession.requestAnimationFrame(fn);
        else
            return this.player.requestAnimationFrame(fn);
    }

    cancelAnimationFrame(id) {
        return this.player.cancelAnimationFrame(id);
    }

    togglePlay_() {
        if (this.player.paused()) {
            this.player.play();
        } else {
            this.player.pause();
        }
    }

    // request the iOS 13+ DeviceOrientation permission and attach the sensor;
    // must be called from a user gesture handler, no-op everywhere else
    enableOrientation() {
        if (this.controls3d)
            this.controls3d.enableOrientation();
    }

    animate_(xrTimestamp, xrFrame) {
        if (!this.initialized_) {
            return;
        }
        // The mono drawing buffer is sized only once, in init(), from
        // player.currentWidth()/currentHeight(). On mobile those can read 0 at
        // that instant (vjs-fluid applies its aspect-ratio height after the
        // loadedmetadata that drives init) and no window 'resize' event need
        // follow, so the buffer stays 0-area and the CSS-stretched canvas
        // paints solid black with no recovery. Re-apply the size whenever the
        // player's reported size changes to a valid value. Skipped while an XR
        // session presents, because WebXRManager owns the framebuffer then.
        if (!this.xrActive) {
            const w = this.player.currentWidth();
            const h = this.player.currentHeight();
            if (w && h && (w !== this.lastWidth_ || h !== this.lastHeight_)) {
                this.handleResize_();
            }
        }
        if (this.getVideoEl_().readyState === this.getVideoEl_().HAVE_ENOUGH_DATA) {
            if (this.videoTexture) {
                this.videoTexture.needsUpdate = true;
            }
        }

        if (!this.xrActive)
            this.controls3d.update();

        if (this.xrActive && xrFrame) {
            this.xrPose = xrFrame.getViewerPose(this.xrReferenceSpace);
            this.trigger('xrCameraUpdate');
        }

        this.camera.getWorldDirection(this.cameraVector);
        this.animationFrameId_ = this.requestAnimationFrame(this.animate_);
        
        this.renderer.render(this.scene, this.camera);
    }

    handleResize_() {
        const width = this.player.currentWidth();
        const height = this.player.currentHeight();

        // A collapsed layout (mobile can report 0 while vjs-fluid has not yet
        // applied its aspect-ratio height) must not bake a 0-area buffer or a
        // width/0 == Infinity aspect. Keep the last good size, retry next tick.
        if (!width || !height) {
            return;
        }

        // videojs-vr, which this plugin is based on, resizes the renderer on
        // every resize; that call was lost in the port, so the drawing buffer
        // stayed frozen at whatever size init() sampled. Restore it.
        // updateStyle is false on purpose: init() styles the canvas
        // width/height as 100% so it tracks the player, and setSize's default
        // would overwrite that with fixed pixel values and break fluid layouts.
        // Only the drawing buffer should change here.
        if (this.renderer) {
            this.renderer.setSize(width, height, false);
        }

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();

        this.lastWidth_ = width;
        this.lastHeight_ = height;
    }

    init() {
        this.reset();

        this.xrSupported = false;
        this.camera = new THREE.PerspectiveCamera(75, this.player.currentWidth() / this.player.currentHeight(), 1, 1000);
        // Store vector representing the direction in which the camera is looking, in world space.
        this.cameraVector = new THREE.Vector3();
        this.camera.layers.enable(1);

        this.scene = new THREE.Scene();
        this.videoTexture = new THREE.VideoTexture(this.getVideoEl_());

        // shared regardless of wether VideoTexture is used or
        // an image canvas is used
        this.videoTexture.generateMipmaps = false;
        this.videoTexture.minFilter = THREE.LinearFilter;
        this.videoTexture.magFilter = THREE.LinearFilter;
        this.videoTexture.format = THREE.RGBFormat;

        const position = { x: 0, y: 0, z: 0 };

        if (this.scene) {
            this.scene.remove(this.movieScreen);
        }

        // 360 equirectangular projection.
        //
        // Segment count matters more than it looks: UV interpolation across a
        // quad is linear, but the equirect-to-sphere mapping is not, so every
        // quad bends whatever straight line crosses it. At 32x32 a quad spans
        // 11.25 degrees of azimuth and the bowing is plainly visible on any
        // straight-edged content, worst near the poles where the azimuth
        // segments converge into slivers. 256x128 puts a quad at about 1.4
        // degrees, around 65k triangles, negligible for a GPU that is already
        // playing back video.
        this.movieGeometry = new THREE.SphereBufferGeometry(256, 256, 128);
        this.movieMaterial = new THREE.MeshBasicMaterial({ map: this.videoTexture, side: THREE.BackSide });

        this.movieScreen = new THREE.Mesh(this.movieGeometry, this.movieMaterial);
        this.movieScreen.position.set(position.x, position.y, position.z);

        this.movieScreen.scale.x = -1;
        this.movieScreen.quaternion.setFromAxisAngle({ x: 0, y: 1, z: 0 }, -Math.PI / 2);
        this.scene.add(this.movieScreen);

        this.player.removeChild('BigPlayButton');
        this.player.addChild('BigVrPlayButton', {}, this.bigPlayButtonIndex_);
        this.player.bigPlayButton = this.player.getChild('BigVrPlayButton');

        this.camera.position.set(0, 0, 0);
        this.renderer = new THREE.WebGLRenderer({
            devicePixelRatio: window.devicePixelRatio,
            alpha: false,
            clearColor: 0xffffff,
            antialias: true
        });   

        this.renderer.setSize(this.player.currentWidth(), this.player.currentHeight());

        this.renderedCanvas = this.renderer.domElement;
        this.renderedCanvas.setAttribute('style', 'width: 100%; height: 100%; position: absolute; top:0;');

        const videoElStyle = this.getVideoEl_().style;

        this.player.el().insertBefore(this.renderedCanvas, this.player.el().firstChild);
        videoElStyle.zIndex = '-1';
        videoElStyle.opacity = '0';
        this.xrActive = false;

        if (!this.controls3d) {
            // self.controls3d = new OrbitControls(self.camera, self.renderedCanvas);
            const options = {
                camera: this.camera,
                canvas: this.renderedCanvas,
                // check if its a half sphere view projection
                halfView: false,
                orientation: this.options.orientation !== undefined ?
                    !!this.options.orientation : videojs.browser.IS_ANDROID || videojs.browser.IS_IOS
            };

            this.controls3d = new OrbitOrientationControls(options);
            this.canvasPlayerControls = new CanvasPlayerControls(this.player, this.renderedCanvas);
        }

        if (window.navigator.xr) {
            this.renderer.xr.enabled = true;
            // this.renderer.xr.setReferenceSpaceType('local');
            var self = this;
            navigator.xr.isSessionSupported('immersive-vr').then(function (supported) {
                self.xrSupported = supported;
                if (supported) {
                    self.addCardboardButton_();
                    console.log('webxr session supported');
                } else {
                    console.log('web xr device not found, using orbit controls');
                }
            });
        } else {
            console.log('web xr not available');
        }

        self.completeInitialization(); // wait until controls are initialized
        this.animationFrameId_ = this.requestAnimationFrame(this.animate_);

        this.on(this.player, 'fullscreenchange', this.handleResize_);
        window.addEventListener('vrdisplaypresentchange', this.handleResize_, true);
        window.addEventListener('resize', this.handleResize_, true);
        // these are triggered by the carboard button:
        window.addEventListener('vrdisplayactivate', this.handleVrDisplayActivate_, true);
        window.addEventListener('vrdisplaydeactivate', this.handleVrDisplayDeactivate_, true);

    }

    completeInitialization() {
        this.initialized_ = true;
        this.trigger('initialized');
    }

    addCardboardButton_() {
        if (!this.player.controlBar.getChild('CardboardButton')) {
            this.player.controlBar.addChild('CardboardButton', {});
        }
    }

    getVideoEl_() {
        return this.player.el().getElementsByTagName('video')[0];
    }

    reset() {
        if (!this.initialized_) {
            return;
        }

        if (this.controls3d) {
            this.controls3d.dispose();
            this.controls3d = null;
        }

        if (this.canvasPlayerControls) {
            this.canvasPlayerControls.dispose();
            this.canvasPlayerControls = null;
        }

        window.removeEventListener('resize', this.handleResize_, true);
        window.removeEventListener('vrdisplaypresentchange', this.handleResize_, true);
        window.removeEventListener('vrdisplayactivate', this.handleVrDisplayActivate_, true);
        window.removeEventListener('vrdisplaydeactivate', this.handleVrDisplayDeactivate_, true);

        // re-add the big play button to player
        if (!this.player.getChild('BigPlayButton')) {
            this.player.addChild('BigPlayButton', {}, this.bigPlayButtonIndex_);
        }

        if (this.player.getChild('BigVrPlayButton')) {
            this.player.removeChild('BigVrPlayButton');
        }

        // remove the cardboard button
        if (this.player.getChild('CardboardButton')) {
            this.player.controlBar.removeChild('CardboardButton');
        }

        // reset the video element style so that it will be displayed
        const videoElStyle = this.getVideoEl_().style;

        videoElStyle.zIndex = '';
        videoElStyle.opacity = '';

        // remove the old canvas
        if (this.renderedCanvas) {
            this.renderedCanvas.parentNode.removeChild(this.renderedCanvas);
        }

        if (this.animationFrameId_) {
            this.cancelAnimationFrame(this.animationFrameId_);
        }

        this.initialized_ = false;
    }

    dispose() {
        this.reset();
        super.dispose();
    }

    polyfillVersion() {
        return WebXRPolyfill.version;
    }

}

// Define default values for the plugin's `state` object here.
Xr.defaultState = {};

// Include the version number.
Xr.VERSION = VERSION;

// Register the plugin with video.js.
videojs.registerPlugin('xr', Xr);

export default Xr;
