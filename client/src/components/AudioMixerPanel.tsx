'use client';

import React from 'react';
import { useAudioMixer } from '../context/AudioMixerContext';
import { Volume2, Mic, Music, Tv, Activity, Sliders, ToggleLeft, ToggleRight } from 'lucide-react';

export const AudioMixerPanel: React.FC = () => {
  const {
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
    isSpeaking,
    micEchoCancellation,
    setMicEchoCancellation,
    micNoiseSuppression,
    setMicNoiseSuppression,
    micAutoGainControl,
    setMicAutoGainControl
  } = useAudioMixer();

  return (
    <div className="flex flex-col h-full bg-black/40 border-l border-white/10 backdrop-blur-md text-white w-80">
      <div className="p-4 border-b border-white/10 flex items-center gap-2">
        <Sliders size={20} className="text-emerald-400" />
        <h2 className="text-lg font-semibold tracking-wide">Audio Mixer</h2>
      </div>

      <div className="flex-1 p-5 overflow-y-auto space-y-6">
        {/* Voice Volume Control */}
        <div className="space-y-2">
          <div className="flex justify-between items-center text-sm font-medium">
            <span className="flex items-center gap-2 text-white/80">
              <Volume2 size={16} className="text-blue-400" />
              Incoming Voice
            </span>
            <span className="text-xs text-white/50">{Math.round(voiceVolume * 100)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={voiceVolume}
            onChange={(e) => setVoiceVolume(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
        </div>

        {/* Music Volume Control */}
        <div className="space-y-2">
          <div className="flex justify-between items-center text-sm font-medium">
            <span className="flex items-center gap-2 text-white/80">
              <Music size={16} className="text-fuchsia-400" />
              Music Volume
            </span>
            <span className="text-xs text-white/50">{Math.round(musicVolume * 100)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={musicVolume}
            onChange={(e) => setMusicVolume(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-fuchsia-500"
          />
        </div>

        {/* Screen Share Volume Control */}
        <div className="space-y-2">
          <div className="flex justify-between items-center text-sm font-medium">
            <span className="flex items-center gap-2 text-white/80">
              <Tv size={16} className="text-amber-400" />
              Screen Share Audio
            </span>
            <span className="text-xs text-white/50">{Math.round(screenShareVolume * 100)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={screenShareVolume}
            onChange={(e) => setScreenShareVolume(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-amber-500"
          />
        </div>

        {/* Local Microphone Transmit Volume */}
        <div className="space-y-2">
          <div className="flex justify-between items-center text-sm font-medium">
            <span className="flex items-center gap-2 text-white/80">
              <Mic size={16} className="text-emerald-400" />
              Microphone Gain
            </span>
            <span className="text-xs text-white/50">{Math.round(micVolume * 100)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={micVolume}
            onChange={(e) => setMicVolume(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-emerald-500"
          />
        </div>

        {/* Microphone Hardware Features */}
        <div className="space-y-4 bg-white/5 p-4 rounded-2xl border border-white/5 shadow-inner">
          <span className="text-xs font-bold uppercase tracking-wider text-white/40 block mb-1">
            🎙️ Mic Hardware Processing
          </span>

          {/* Echo Cancellation */}
          <div className="flex justify-between items-center text-sm">
            <div className="flex flex-col">
              <span className="font-semibold text-white/90">Echo Cancellation</span>
              <span className="text-[10px] text-white/40">Prevents speakers loopback</span>
            </div>
            <button
              onClick={() => setMicEchoCancellation(!micEchoCancellation)}
              className="text-emerald-400 hover:text-emerald-300 transition-colors focus:outline-none"
            >
              {micEchoCancellation ? (
                <ToggleRight size={30} className="fill-emerald-500/20" />
              ) : (
                <ToggleLeft size={30} className="text-white/40" />
              )}
            </button>
          </div>

          {/* Noise Suppression */}
          <div className="flex justify-between items-center text-sm">
            <div className="flex flex-col">
              <span className="font-semibold text-white/90">Noise Suppression</span>
              <span className="text-[10px] text-white/40">Filters background noise</span>
            </div>
            <button
              onClick={() => setMicNoiseSuppression(!micNoiseSuppression)}
              className="text-emerald-400 hover:text-emerald-300 transition-colors focus:outline-none"
            >
              {micNoiseSuppression ? (
                <ToggleRight size={30} className="fill-emerald-500/20" />
              ) : (
                <ToggleLeft size={30} className="text-white/40" />
              )}
            </button>
          </div>

          {/* Auto Gain Control */}
          <div className="flex justify-between items-center text-sm">
            <div className="flex flex-col">
              <span className="font-semibold text-white/90">Auto Gain Control</span>
              <span className="text-[10px] text-white/40">Auto leveling (Pro Audio off)</span>
            </div>
            <button
              onClick={() => setMicAutoGainControl(!micAutoGainControl)}
              className="text-emerald-400 hover:text-emerald-300 transition-colors focus:outline-none"
            >
              {micAutoGainControl ? (
                <ToggleRight size={30} className="fill-emerald-500/20" />
              ) : (
                <ToggleLeft size={30} className="text-white/40" />
              )}
            </button>
          </div>
        </div>

        <hr className="border-white/10 my-6" />

        {/* Ducking Controls */}
        <div className="space-y-5 bg-white/5 p-4 rounded-2xl border border-white/5 shadow-inner">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium flex items-center gap-2 text-white/90">
              <Activity size={16} className="text-emerald-400" />
              Auto Music Ducking
            </span>
            <button
              onClick={() => setDuckingEnabled(!duckingEnabled)}
              className="text-emerald-400 hover:text-emerald-300 transition-colors focus:outline-none"
            >
              {duckingEnabled ? (
                <ToggleRight size={32} className="fill-emerald-500/20" />
              ) : (
                <ToggleLeft size={32} className="text-white/40" />
              )}
            </button>
          </div>

          {duckingEnabled && (
            <div className="space-y-4 pt-2 animate-fade-in">
              {/* Speaking Indicator */}
              <div className="flex items-center justify-between bg-black/30 px-3 py-2 rounded-xl border border-white/5">
                <span className="text-xs text-white/60">Voice Detection Status</span>
                <span className="flex items-center gap-1.5 text-xs font-semibold">
                  <span
                    className={`h-2 w-2 rounded-full transition-all duration-300 ${
                      isSpeaking
                        ? 'bg-emerald-500 shadow-[0_0_8px_#10b981] animate-ping'
                        : 'bg-white/20'
                    }`}
                  />
                  <span className={isSpeaking ? 'text-emerald-400' : 'text-white/40'}>
                    {isSpeaking ? 'Active Speaker' : 'Quiet'}
                  </span>
                </span>
              </div>

              {/* Ducking Depth Slider */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-white/60">
                  <span>Ducking Depth (Music Reduction)</span>
                  <span>{Math.round(duckingAmount * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="0.95"
                  step="0.05"
                  value={duckingAmount}
                  onChange={(e) => setDuckingAmount(parseFloat(e.target.value))}
                  className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
              </div>

              {/* Ducking Sensitivity/Threshold Slider */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-white/60">
                  <span>Mic Trigger Sensitivity</span>
                  <span>{Math.round((1 - duckingThreshold) * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.005"
                  max="0.1"
                  step="0.005"
                  value={duckingThreshold}
                  onChange={(e) => setDuckingThreshold(parseFloat(e.target.value))}
                  className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  style={{ transform: 'scaleX(-1)' }} // Invert visualization: higher threshold = less sensitive
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
