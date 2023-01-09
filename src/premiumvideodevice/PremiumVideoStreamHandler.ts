import Logger from '../logger/Logger';
import PremiumVideoEffectDriver from './PremiumVideoEffectDriver';

const DEFAULT_FRAMERATE = 15;
const MIN_FRAME_DELAY = 0;
const MS_PER_SECOND = 1000;

/** @internal */
interface HTMLCanvasElementWithCaptureStream extends HTMLCanvasElement {
  // Not in IE, but that's OK.
  captureStream(frameRate?: number): MediaStream;
}

/**
 * [[PremiumVideoStreamHandler]] Will be used to handle the stream associated with the
 * device in the DefaultVideoTransformDevice. It is responsible for triggering the
 * action in the PremiumVideoEffectDriver and processing the transformed frames onto
 * the output canvas
 */
export default class PremiumVideoStreamHandler {
  private framerate: number = DEFAULT_FRAMERATE;
  private lastTimeOut: ReturnType<typeof setTimeout> | undefined;

  // Inputs
  private videoInput: HTMLVideoElement = document.createElement('video') as HTMLVideoElement;
  private canvasInput: HTMLCanvasElement = document.createElement('canvas');
  private inputCtx = this.canvasInput.getContext('2d');
  private inputVideoStream: MediaStream | null = null;

  // Outputs
  private canvasOutput: HTMLCanvasElementWithCaptureStream = document.createElement(
    'canvas'
  ) as HTMLCanvasElementWithCaptureStream;
  private outputCtx = this.canvasOutput.getContext('2d');
  outputMediaStream: MediaStream = new MediaStream();

  // Constructor just sets a logger for the object
  constructor(private logger: Logger, private videoEffectDriver: PremiumVideoEffectDriver) {}

  /**
   * If existing, return the output media stream. If not existing, create and return
   * a media stream off of our output canvas
   * @returns MediaStream
   */
  getActiveOutputMediaStream(): MediaStream {
    if (this.isOutputMediaStreamActive()) {
      return this.outputMediaStream;
    }
    this.outputMediaStream = this.canvasOutput.captureStream(this.framerate);
    this.cloneInputAudioTracksToOutput();
    return this.outputMediaStream;
  }

  /**
   * Configure an inputMediaStream so that it is placed onto a HTML video element and
   * configure our transformation function (apply) to process as our stream continues
   * loading new data
   */
  async setInputMediaStream(inputMediaStream: MediaStream | null): Promise<void> {
    if (!inputMediaStream) {
      this.stop();
      return;
    }

    if (inputMediaStream.getVideoTracks().length === 0) {
      this.logger.error('No video tracks in input media stream, ignoring');
      return;
    }

    this.inputVideoStream = inputMediaStream;
    await this.startVideoOnMediaStream(inputMediaStream);
    this.cloneInputAudioTracksToOutput();
  }

  private async startVideoOnMediaStream(inputMediaStream: MediaStream): Promise<void> {
    const settings = this.inputVideoStream.getVideoTracks()[0].getSettings();
    this.canvasOutput.width = settings.width;
    this.canvasOutput.height = settings.height;
    this.videoInput.addEventListener('loadedmetadata', this.process); // this will be the trigger function
    this.videoInput.srcObject = this.inputVideoStream;
    // avoid iOS safari full screen video -- not sure what this does
    this.videoInput.setAttribute('playsinline', 'true');

    this.videoInput.load();
    try {
      await this.videoInput.play();
    } catch {
      this.logger.warn('Video element play() overriden by another load()');
    }
    return;
  }

  /**
   * Transform a singular frame from the input stream to apply desired
   * video effects. Then place the output image data onto our output canvas
   * configured with an output stream
   */
  process = async (_event: Event): Promise<void> => {
    if (!this.inputVideoStream) {
      return;
    }
    const processVideoStart = performance.now();

    // Draw the videoInput onto our input canvas
    if (this.videoInput.videoWidth) {
      this.canvasInput.width = this.videoInput.videoWidth;
      this.canvasInput.height = this.videoInput.videoHeight;
      this.inputCtx.drawImage(this.videoInput, 0, 0);
    }

    // Collect out input frame data
    let inputImageData = this.inputCtx.getImageData(
      0,
      0,
      this.canvasInput.width,
      this.canvasInput.height
    );

    // Transform input data
    let transformedImageData = await this.videoEffectDriver.apply(inputImageData);

    // Confirm that the output canvas is still matching video frame size
    if (
      this.canvasOutput.width !== this.videoInput.videoWidth &&
      this.canvasOutput.height !== this.videoInput.videoHeight
    ) {
      this.canvasOutput.width = this.videoInput.videoWidth;
      this.canvasOutput.height = this.videoInput.videoHeight;
    }

    // Place transformed data onto output canvas
    this.outputCtx.putImageData(transformedImageData, 0, 0);

    // timing to maintain requested fps
    const processVideoLatency = performance.now() - processVideoStart;
    const nextFrameDelay = Math.max(MIN_FRAME_DELAY, MS_PER_SECOND / this.framerate - processVideoLatency);

    // TODO: use requestAnimationFrame which is more organic and allows browser to conserve resources by its choices.
    /* @ts-ignore */
    this.lastTimeout = setTimeout(this.process, nextFrameDelay);
  };

  /**
   * Stop invoking our transformation function and stop the video tracks associated
   * with our output media stream
   */
  stop() {
    this.videoInput.removeEventListener('loadedmetadata', this.process);
    this.videoInput.srcObject = null;

    this.destroyInputMediaAndBuffers();

    // Stop all the output tracks, but don't discard the media stream,
    // because it's how other parts of the codebase recognize when
    // a selected stream is part of this transform device.
    this.outputMediaStream?.getTracks().map(track => track.stop());

    // This will prevent the process loop from continuing to call itself
    if (this.lastTimeOut) {
      clearTimeout(this.lastTimeOut);
      this.lastTimeOut = undefined;
    }
  }

  /**
   * Stop the video tracks associated with our input media stream and remove
   * reference to input source
   */
  private destroyInputMediaAndBuffers() {
    this.inputVideoStream?.getTracks().map(track => track.stop());
    this.inputVideoStream = null;
  }

  /**
   * Copy over the audio tracks from our input stream into our output stream
   */
  private cloneInputAudioTracksToOutput(): void {
    if (!this.isOutputMediaStreamActive() || this.inputVideoStream === null) {
      this.logger.info('Not cloning input audio tracks to output, do not have media streams ready');
      return; // Just wait for `getActiveOutputMediaStream`
    }

    // Remove current audio tracks from output
    for (const audioTrack of this.outputMediaStream.getAudioTracks()) {
      this.logger.info(`Removing audio track ${audioTrack.id} from output stream`);
      this.outputMediaStream.removeTrack(audioTrack);
    }

    // Add new audio track to output
    for (const audioTrack of this.inputVideoStream.getAudioTracks()) {
      this.logger.info(`Adding audio track ${audioTrack.id} to output stream`);
      this.outputMediaStream.addTrack(audioTrack);
    }
  }

  /**
   * Return boolean representing status of our output media stream being active
   */
  private isOutputMediaStreamActive(): boolean {
    return this.outputMediaStream && this.outputMediaStream.active;
  }
}
