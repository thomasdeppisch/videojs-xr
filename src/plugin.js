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

/**
 * An advanced Video.js plugin. For more information on the API
 *
 * See: https://blog.videojs.com/feature-spotlight-advanced-plugins/
 */
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

        this.polyfill_ = new WebXRPolyfill();

        this.handleVrDisplayActivate_ = videojs.bind(this, this.handleVrDisplayActivate_);
        this.handleVrDisplayDeactivate_ = videojs.bind(this, this.handleVrDisplayDeactivate_);
        this.handleResize_ = videojs.bind(this, this.handleResize_);
        this.animate_ = videojs.bind(this, this.animate_);

        this.on(player, 'loadedmetadata', this.init);

        this.player.ready(() => {
            this.player.addClass('vjs-xr');
        });
    }

    handleVrDisplayActivate_() {

        if (!this.xrSupported)
            return;

        var self = this;
        var sessionInit = { optionalFeatures: ['local-floor', 'bounded-floor'] };
        navigator.xr.requestSession('immersive-vr', sessionInit).then(function (session) {
            console.log('set session');
            console.log(session);
            self.renderer.xr.setSession(session);
            self.xrActive = true;
        });


        // if (!this.vrDisplay) {
        //     return;
        // }
        // this.vrDisplay.requestPresent([{ source: this.renderedCanvas }]).then(() => {
        //     if (!this.vrDisplay.cardboardUI_ || !videojs.browser.IS_IOS) {
        //         return;
        //     }

        //     // webvr-polyfill/cardboard ui only watches for click events
        //     // to tell that the back arrow button is pressed during cardboard vr.
        //     // but somewhere along the line these events are silenced with preventDefault
        //     // but only on iOS, so we translate them ourselves here
        //     let touches = [];
        //     const iosCardboardTouchStart_ = (e) => {
        //         for (let i = 0; i < e.touches.length; i++) {
        //             touches.push(e.touches[i]);
        //         }
        //     };

        //     const iosCardboardTouchEnd_ = (e) => {
        //         if (!touches.length) {
        //             return;
        //         }

        //         touches.forEach((t) => {
        //             const simulatedClick = new window.MouseEvent('click', {
        //                 screenX: t.screenX,
        //                 screenY: t.screenY,
        //                 clientX: t.clientX,
        //                 clientY: t.clientY
        //             });

        //             this.renderedCanvas.dispatchEvent(simulatedClick);
        //         });

        //         touches = [];
        //     };

        //     this.renderedCanvas.addEventListener('touchstart', iosCardboardTouchStart_);
        //     this.renderedCanvas.addEventListener('touchend', iosCardboardTouchEnd_);

        //     this.iosRevertTouchToClick_ = () => {
        //         this.renderedCanvas.removeEventListener('touchstart', iosCardboardTouchStart_);
        //         this.renderedCanvas.removeEventListener('touchend', iosCardboardTouchEnd_);
        //         this.iosRevertTouchToClick_ = null;
        //     };
        // });
    }

    handleVrDisplayDeactivate_() {
        if (!this.vrDisplay || !this.vrDisplay.isPresenting) {
            return;
        }
        if (this.iosRevertTouchToClick_) {
            this.iosRevertTouchToClick_();
        }
        this.vrDisplay.exitPresent();

    }

    requestAnimationFrame(fn) {
        if (this.vrDisplay) {
            return this.vrDisplay.requestAnimationFrame(fn);
        }

        return this.player.requestAnimationFrame(fn);
    }

    cancelAnimationFrame(id) {
        if (this.vrDisplay) {
            return this.vrDisplay.cancelAnimationFrame(id);
        }

        return this.player.cancelAnimationFrame(id);
    }

    togglePlay_() {
        if (this.player.paused()) {
            this.player.play();
        } else {
            this.player.pause();
        }
    }

    animate_() {
        if (!this.initialized_) {
            return;
        }
        if (this.getVideoEl_().readyState === this.getVideoEl_().HAVE_ENOUGH_DATA) {
            if (this.videoTexture) {
                this.videoTexture.needsUpdate = true;
            }
        }

        this.camera.getWorldDirection(this.cameraVector);
        this.animationFrameId_ = this.requestAnimationFrame(this.animate_);

        if (!this.xrActive)
            this.controls3d.update();
        
        this.renderer.render(this.scene, this.camera);
    }

    handleResize_() {
        const width = this.player.currentWidth();
        const height = this.player.currentHeight();

        // this.effect.setSize(width, height, false);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
    }

    init() {
        console.log(this);
        // this.reset();

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

        // 360 equirectangular projection
        this.movieGeometry = new THREE.SphereBufferGeometry(256, 32, 32);
        this.movieMaterial = new THREE.MeshBasicMaterial({ map: this.videoTexture, side: THREE.BackSide });

        this.movieScreen = new THREE.Mesh(this.movieGeometry, this.movieMaterial);
        this.movieScreen.position.set(position.x, position.y, position.z);

        this.movieScreen.scale.x = -1;
        this.movieScreen.quaternion.setFromAxisAngle({ x: 0, y: 1, z: 0 }, -Math.PI / 2);
        this.scene.add(this.movieScreen);

        // this.currentProjection_ = '360';

        this.player.removeChild('BigPlayButton');
        this.player.addChild('BigVrPlayButton', {}, this.bigPlayButtonIndex_);
        this.player.bigPlayButton = this.player.getChild('BigVrPlayButton');

        this.camera.position.set(0, 0, 0);
        // this.renderer = new THREE.WebGLRenderer();
        // this.renderer.setPixelRatio( window.devicePixelRatio );
        this.renderer = new THREE.WebGLRenderer({
            devicePixelRatio: window.devicePixelRatio,
            alpha: false,
            clearColor: 0xffffff,
            antialias: true
        });
        

        // const webglContext = this.renderer.getContext('webgl');
        // const oldTexImage2D = webglContext.texImage2D;

        // /* this is a workaround since threejs uses try catch */
        // webglContext.texImage2D = (...args) => {
        //     try {
        //         return oldTexImage2D.apply(webglContext, args);
        //     } catch (e) {
        //         this.reset();
        //         this.player_.pause();
        //         this.triggerError_({ code: 'web-vr-hls-cors-not-supported', dismiss: false });
        //         throw new Error(e);
        //     }
        // };

        // this.vrDisplay = null;
        this.renderer.setSize(this.player.currentWidth(), this.player.currentHeight());

        this.renderedCanvas = this.renderer.domElement;
        this.renderedCanvas.setAttribute('style', 'width: 100%; height: 100%; position: absolute; top:0;');

        const videoElStyle = this.getVideoEl_().style;

        this.player.el().insertBefore(this.renderedCanvas, this.player.el().firstChild);
        videoElStyle.zIndex = '-1';
        videoElStyle.opacity = '0';

        //document.body.appendChild( VRButton.createButton( this.renderer, { referenceSpaceType: 'local' } ) );
        this.xrActive = false;

        if (!this.controls3d) {
            // self.controls3d = new OrbitControls(self.camera, self.renderedCanvas);
            const options = {
                camera: this.camera,
                canvas: this.renderedCanvas,
                // check if its a half sphere view projection
                halfView: false,
                orientation: false
            };

            this.controls3d = new OrbitOrientationControls(options);
            this.canvasPlayerControls = new CanvasPlayerControls(this.player, this.renderedCanvas);
        }

        if (window.navigator.xr) {
            console.log('webxr supported');
            this.renderer.xr.enabled = true;
            this.renderer.xr.setReferenceSpaceType('local');
            var self = this;
            navigator.xr.isSessionSupported('immersive-vr').then(function (supported) {
                if (supported) {
                    self.xrSupported = true;
                    self.addCardboardButton_();
                    console.log('xr session supported');
                } else {
                    console.log('web xr device not found, using orbit controls');
                }
            });
        } else {
            console.log('web xr not available (only works in https)');
        }

        self.completeInitialization(); // wait until controls are initialized

        this.animationFrameId_ = this.requestAnimationFrame(this.animate_);

        this.on(this.player, 'fullscreenchange', this.handleResize_);
        window.addEventListener('vrdisplaypresentchange', this.handleResize_, true);
        window.addEventListener('resize', this.handleResize_, true);
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

        if (this.omniController) {
            this.omniController.off('audiocontext-suspended');
            this.omniController.dispose();
            this.omniController = undefined;
        }

        if (this.controls3d) {
            this.controls3d.dispose();
            this.controls3d = null;
        }

        if (this.canvasPlayerControls) {
            this.canvasPlayerControls.dispose();
            this.canvasPlayerControls = null;
        }

        if (this.effect) {
            this.effect.dispose();
            this.effect = null;
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

        // set the current projection to the default
        this.currentProjection_ = this.defaultProjection_;

        // reset the ios touch to click workaround
        if (this.iosRevertTouchToClick_) {
            this.iosRevertTouchToClick_();
        }

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
        super.dispose();
        this.reset();
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
