export type VoiceDependencies = {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  MediaRecorder: typeof MediaRecorder;
};

export function createVoiceCapture(dependencies: VoiceDependencies) {
  let stream: MediaStream | null = null;

  return {
    async prepare() {
      try {
        stream = await dependencies.getUserMedia({ audio: true });
        return stream;
      } catch (error) {
        stream = null;
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
          throw new Error('Microphone permission was not granted.');
        }
        throw new Error('Microphone is unavailable.');
      }
    },
    release() {
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    },
    isActive() {
      return stream !== null;
    },
  };
}
