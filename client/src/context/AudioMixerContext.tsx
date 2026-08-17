'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

interface AudioMixerContextType {
  initAudio: () => void;
  voiceVolume: number;
  setVoiceVolume: (v: number) => void;
  musicVolume: number;
  setMusicVolume: (v: number) => void;
  screenShareVolume: number;
  setScreenShareVolume: (v: number) => void;
  micVolume: number;
  setMicVolume: (v: number) => void;
  duckingEnabled: boolean;
  setDuckingEnabled: (enabled: boolean) => void;
  duckingThreshold: number;
  setDuckingThreshold: (t: number) => void;
  duckingAmount: number;
  setDuckingAmount: (a: number) => void;
  registerMusicElement: (audio: HTMLAudioElement) => void;
  registerRemoteVoiceTrack: (trackId: string, track: MediaStreamTrack) => void;
  unregisterRemoteVoiceTrack: (trackId: string) => void;
  registerRemoteScreenShareTrack: (trackId: string, track: MediaStreamTrack) => void;
  unregisterRemoteScreenShareTrack: (trackId: string) => void;
  processLocalMicTrack: (track: MediaStreamTrack) => Promise<MediaStreamTrack>;
  isSpeaking: boolean;
  audioContext: AudioContext | null;
}

const AudioMixerContext = createContext<AudioMixerContextType | undefined>(undefined);

export const useAudioMixer = () => {
  const context = useContext(AudioMixerContext);
  if (!context) {
    throw new Error('useAudioMixer must be used within an AudioMixerProvider');
  }
  return context;
};

export const AudioMixerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Volume states (0 to 1)
  const [voiceVolume, _setVoiceVolume] = useState<number>(0.8);
  const [musicVolume, _setMusicVolume] = useState<number>(0.5);
  const [screenShareVolume, _setScreenShareVolume] = useState<number>(0.8);
  const [micVolume, _setMicVolume] = useState<number>(0.8);

  // Ducking states
  const [duckingEnabled, setDuckingEnabled] = useState<boolean>(true);
  const [duckingThreshold, setDuckingThreshold] = useState<number>(0.02); // RMS amplitude threshold
  const [duckingAmount, setDuckingAmount] = useState<number>(0.7); // 70% reduction by default
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);

  // Web Audio Context & Nodes refs
  const audioContextRef = useRef<AudioContext | null>(null);
  
  // Gains
  const voiceGainNodeRef = useRef<GainNode | null>(null);
  const musicGainNodeRef = useRef<GainNode | null>(null);
  const duckingGainNodeRef = useRef<GainNode | null>(null);
  const screenShareGainNodeRef = useRef<GainNode | null>(null);
  const micGainNodeRef = useRef<GainNode | null>(null);

  // Analyser for remote voices to trigger ducking
  const voiceAnalyserRef = useRef<AnalyserNode | null>(null);

  // Tracking sources to avoid duplicates
  const remoteVoiceSourcesRef = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());
  const remoteScreenShareSourcesRef = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());
  const localMicSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const localMicDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const musicSourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  // Hold timer for speech detection
  const speechEndTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastActiveSpeechRef = useRef<number>(0);

  // Initialize Web Audio API graph
  const initAudio = () => {
    if (audioContextRef.current) {
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume().catch(() => {});
      }
      return;
    }

    console.log('Initializing Web Audio API Mixer Graph...');
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioContextClass();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    audioContextRef.current = ctx;

    // Create Gain Nodes
    const voiceGain = ctx.createGain();
    voiceGain.gain.setValueAtTime(voiceVolume, ctx.currentTime);
    voiceGainNodeRef.current = voiceGain;

    const musicGain = ctx.createGain();
    musicGain.gain.setValueAtTime(musicVolume, ctx.currentTime);
    musicGainNodeRef.current = musicGain;

    const duckingGain = ctx.createGain();
    duckingGain.gain.setValueAtTime(1.0, ctx.currentTime);
    duckingGainNodeRef.current = duckingGain;

    const screenShareGain = ctx.createGain();
    screenShareGain.gain.setValueAtTime(screenShareVolume, ctx.currentTime);
    screenShareGainNodeRef.current = screenShareGain;

    const micGain = ctx.createGain();
    micGain.gain.setValueAtTime(micVolume, ctx.currentTime);
    micGainNodeRef.current = micGain;

    // Create Analyser for remote voice
    const voiceAnalyser = ctx.createAnalyser();
    voiceAnalyser.fftSize = 256;
    voiceAnalyserRef.current = voiceAnalyser;

    // Connect remote voice path: sources -> voiceAnalyser -> voiceGain -> destination
    voiceAnalyser.connect(voiceGain);
    voiceGain.connect(ctx.destination);

    // Connect music path: source -> musicGain -> duckingGain -> destination
    musicGain.connect(duckingGain);
    duckingGain.connect(ctx.destination);

    // Connect screen share path: sources -> screenShareGain -> destination
    screenShareGain.connect(ctx.destination);

    // Start speaking detection loop
    startSpeakingDetection();
  };

  // Ensure AudioContext is resumed on user gesture
  useEffect(() => {
    const resumeCtx = () => {
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume().catch(() => {});
      }
    };
    window.addEventListener('click', resumeCtx);
    window.addEventListener('keydown', resumeCtx);
    window.addEventListener('touchstart', resumeCtx);
    return () => {
      window.removeEventListener('click', resumeCtx);
      window.removeEventListener('keydown', resumeCtx);
      window.removeEventListener('touchstart', resumeCtx);
    };
  }, []);

  // Adjust volume levels dynamically
  const setVoiceVolume = (v: number) => {
    _setVoiceVolume(v);
    if (voiceGainNodeRef.current && audioContextRef.current) {
      voiceGainNodeRef.current.gain.setTargetAtTime(v, audioContextRef.current.currentTime, 0.05);
    }
  };

  const setMusicVolume = (v: number) => {
    _setMusicVolume(v);
    if (musicGainNodeRef.current && audioContextRef.current) {
      musicGainNodeRef.current.gain.setTargetAtTime(v, audioContextRef.current.currentTime, 0.05);
    }
  };

  const setScreenShareVolume = (v: number) => {
    _setScreenShareVolume(v);
    if (screenShareGainNodeRef.current && audioContextRef.current) {
      screenShareGainNodeRef.current.gain.setTargetAtTime(v, audioContextRef.current.currentTime, 0.05);
    }
  };

  const setMicVolume = (v: number) => {
    _setMicVolume(v);
    if (micGainNodeRef.current && audioContextRef.current) {
      micGainNodeRef.current.gain.setTargetAtTime(v, audioContextRef.current.currentTime, 0.05);
    }
  };

  // Register HTML5 audio element for music
  const registerMusicElement = (audio: HTMLAudioElement) => {
    if (!audioContextRef.current) initAudio();
    const ctx = audioContextRef.current!;

    // Avoid duplicate wrapping if already registered
    if (musicSourceRef.current) {
      return;
    }

    try {
      const source = ctx.createMediaElementSource(audio);
      musicSourceRef.current = source;
      source.connect(musicGainNodeRef.current!);
      console.log('Successfully registered music element to Web Audio graph.');
    } catch (error) {
      console.warn('Error registering music element:', error);
    }
  };

  // Register a remote participant's voice track
  const registerRemoteVoiceTrack = (trackId: string, track: MediaStreamTrack) => {
    if (!audioContextRef.current) initAudio();
    const ctx = audioContextRef.current!;

    if (remoteVoiceSourcesRef.current.has(trackId)) return;

    try {
      const mediaStream = new MediaStream([track]);
      const source = ctx.createMediaStreamSource(mediaStream);
      remoteVoiceSourcesRef.current.set(trackId, source);

      // Connect to voice analyser (which then pipes to voiceGain -> destination)
      source.connect(voiceAnalyserRef.current!);
      console.log(`Registered remote voice track: ${trackId}`);
    } catch (error) {
      console.error(`Failed to register remote voice track ${trackId}:`, error);
    }
  };

  const unregisterRemoteVoiceTrack = (trackId: string) => {
    const source = remoteVoiceSourcesRef.current.get(trackId);
    if (source) {
      try {
        source.disconnect();
      } catch (e) {}
      remoteVoiceSourcesRef.current.delete(trackId);
      console.log(`Unregistered remote voice track: ${trackId}`);
    }
  };

  // Register a remote screen share audio track
  const registerRemoteScreenShareTrack = (trackId: string, track: MediaStreamTrack) => {
    if (!audioContextRef.current) initAudio();
    const ctx = audioContextRef.current!;

    if (remoteScreenShareSourcesRef.current.has(trackId)) return;

    try {
      const mediaStream = new MediaStream([track]);
      const source = ctx.createMediaStreamSource(mediaStream);
      remoteScreenShareSourcesRef.current.set(trackId, source);

      // Connect directly to screen share gain
      source.connect(screenShareGainNodeRef.current!);
      console.log(`Registered screen share audio track: ${trackId}`);
    } catch (error) {
      console.error(`Failed to register screen share audio track ${trackId}:`, error);
    }
  };

  const unregisterRemoteScreenShareTrack = (trackId: string) => {
    const source = remoteScreenShareSourcesRef.current.get(trackId);
    if (source) {
      try {
        source.disconnect();
      } catch (e) {}
      remoteScreenShareSourcesRef.current.delete(trackId);
      console.log(`Unregistered screen share audio track: ${trackId}`);
    }
  };

  // Process local mic input: capture track -> gainNode -> destination -> custom track output
  const processLocalMicTrack = async (track: MediaStreamTrack): Promise<MediaStreamTrack> => {
    if (!audioContextRef.current) initAudio();
    const ctx = audioContextRef.current!;

    // Clean up old mic source
    if (localMicSourceRef.current) {
      try {
        localMicSourceRef.current.disconnect();
      } catch (e) {}
    }

    const mediaStream = new MediaStream([track]);
    const source = ctx.createMediaStreamSource(mediaStream);
    localMicSourceRef.current = source;

    // Create a destination node to capture the processed stream
    const dest = ctx.createMediaStreamDestination();
    localMicDestinationRef.current = dest;

    // Connect: source -> micGain -> dest (WebRTC outgoing)
    source.connect(micGainNodeRef.current!);
    micGainNodeRef.current!.connect(dest);

    console.log('Local mic connected to Web Audio graph with custom gain control.');
    return dest.stream.getAudioTracks()[0];
  };

  // Continuous speech amplitude checking
  const startSpeakingDetection = () => {
    const checkVoiceLevel = () => {
      const analyser = voiceAnalyserRef.current;
      const ctx = audioContextRef.current;

      if (!analyser || !ctx) {
        requestAnimationFrame(checkVoiceLevel);
        return;
      }

      // Check average audio level of remote voices
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyser.getByteTimeDomainData(dataArray);

      // Compute Root Mean Square (RMS) amplitude
      let sumSquares = 0;
      for (let i = 0; i < bufferLength; i++) {
        const norm = (dataArray[i] - 128) / 128;
        sumSquares += norm * norm;
      }
      const rms = Math.sqrt(sumSquares / bufferLength);

      if (duckingEnabled) {
        if (rms > duckingThreshold) {
          // Speech detected!
          lastActiveSpeechRef.current = Date.now();
          
          if (!isSpeaking) {
            setIsSpeaking(true);
            // Lower music volume: target value = 1.0 - duckingAmount (e.g. 1.0 - 0.7 = 0.3)
            const targetVolume = Math.max(0.05, 1.0 - duckingAmount);
            if (duckingGainNodeRef.current) {
              duckingGainNodeRef.current.gain.setTargetAtTime(targetVolume, ctx.currentTime, 0.1);
            }
          }

          // Clear any pending recovery timeout
          if (speechEndTimeoutRef.current) {
            clearTimeout(speechEndTimeoutRef.current);
            speechEndTimeoutRef.current = null;
          }
        } else {
          // Silence or ambient noise
          if (isSpeaking && !speechEndTimeoutRef.current) {
            // Wait 1.5s (hold time) of silence before restoring music volume
            speechEndTimeoutRef.current = setTimeout(() => {
              setIsSpeaking(false);
              if (duckingGainNodeRef.current && audioContextRef.current) {
                duckingGainNodeRef.current.gain.setTargetAtTime(1.0, audioContextRef.current.currentTime, 0.3);
              }
              speechEndTimeoutRef.current = null;
            }, 1500);
          }
        }
      }

      requestAnimationFrame(checkVoiceLevel);
    };

    requestAnimationFrame(checkVoiceLevel);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (speechEndTimeoutRef.current) {
        clearTimeout(speechEndTimeoutRef.current);
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  return (
    <AudioMixerContext.Provider
      value={{
        initAudio,
        voiceVolume,
        setVoiceVolume,
        musicVolume,
        setMusicVolume,
        screenShareVolume,
        setScreenShareVolume,
        micVolume,
        setMicVolume,
        duckingEnabled,
        setDuckingEnabled,
        duckingThreshold,
        setDuckingThreshold,
        duckingAmount,
        setDuckingAmount,
        registerMusicElement,
        registerRemoteVoiceTrack,
        unregisterRemoteVoiceTrack,
        registerRemoteScreenShareTrack,
        unregisterRemoteScreenShareTrack,
        processLocalMicTrack,
        isSpeaking,
        audioContext: audioContextRef.current,
      }}
    >
      {children}
    </AudioMixerContext.Provider>
  );
};
