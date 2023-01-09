import Device from '../devicecontroller/Device';
import VideoTransformDevice from '../devicecontroller/VideoTransformDevice';
import Logger from '../logger/Logger';
import PremiumVideoStreamHandler from './PremiumVideoStreamHandler';
import PremiumVideoEffectDriver from './PremiumVideoEffectDriver';

/**
 * [[PremiumVideoTransformDevice]] will allow us to transform a regular device
 * into a format that will allow us to intercept it's MediaStream via a
 * [[PremiumVideoStreamHandler]] and apply frame-level effects via a
 * [[PremiumVideoEffectDriver]]
 */
export default class PremiumVideoTransformDevice implements VideoTransformDevice {
  private inputMediaStream: MediaStream;
  private premiumVideoStreamHandler: PremiumVideoStreamHandler;

  constructor(
    private logger: Logger,
    private device: Device,
    private videoEffectDriver: PremiumVideoEffectDriver
  ) {
    // initialize the stream handler
    this.premiumVideoStreamHandler = new PremiumVideoStreamHandler(logger, videoEffectDriver);
  }

  /**
   * remove access to a media stream and stop all running video tracks
   */
  async stop(): Promise<void> {
    if (this.inputMediaStream) {
      for (const track of this.inputMediaStream.getVideoTracks()) {
        track.stop();
      }
    }
    this.inputMediaStream = null;
  }

  /**
   * return the associated intrinsic device of the [[PremiumVideoTransformDevice]]
   *
   */
  async intrinsicDevice(): Promise<Device> {
    return this.device;
  }

  /**
   * Replace whatever input stream we were previously using and start the configured
   * effect processes in the [[PremiumVideoStreamHandler]]
   */
  async transformStream(mediaStream?: MediaStream): Promise<MediaStream> {
    await this.premiumVideoStreamHandler.setInputMediaStream(mediaStream);
    this.inputMediaStream = mediaStream;
    return this.premiumVideoStreamHandler.getActiveOutputMediaStream();
  }

  /**
   * When our output stream disconnects, we must also stop observing on the input stream
   */
  onOutputStreamDisconnect(): void {
    this.logger.info('DefaultVideoTransformDevice: detach stopping input media stream');

    const deviceIsMediaStream = this.device && (this.device as MediaStream).id;

    // Turn off the camera, unless device is a MediaStream
    if (!deviceIsMediaStream && this.inputMediaStream) {
      this.inputMediaStream.getVideoTracks().map(track => track.stop());
    }
  }

  /**
   * Return the output media stream from the [[PremiumVideoStreamHandler]]
   */
  get outputMediaStream(): MediaStream {
    return this.premiumVideoStreamHandler.outputMediaStream;
  }

  /**
   * Swap out the inner device associated with the existing [[PremiumVideoTransformDevice]]
   * while also saving the associated assets in the videoEffectDriver
   */
  chooseNewInnerDevice(newDevice: Device): PremiumVideoTransformDevice {
    return new PremiumVideoTransformDevice(this.logger, newDevice, this.videoEffectDriver);
  }

  /**
   * Return the current inner device
   */
  getInnerDevice(): Device {
    return this.device;
  }
}
