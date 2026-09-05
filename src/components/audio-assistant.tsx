'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { interpretCommand } from './agent-commands';

interface Message {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  timestamp: string;
}

export function AudioAssistant({ provider }: { provider?: string }) {
  const router = useRouter();
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [statusText, setStatusText] = useState('BrightScope AI Agent Ready');
  const [enabled, setEnabled] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'agent',
      text: `Hello! I am your BrightScope AI Agent powered by ${provider || 'Gemini 2.5 Flash'}. You can speak or type commands below.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);

  const recognitionRef = useRef<any>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatBottomRef.current && isOpen) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setStatusText('Voice input unsupported in this browser.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsListening(true);
      setStatusText('Listening for voice command...');
    };

    recognition.onresult = (event: any) => {
      let current = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        current += event.results[i][0].transcript;
      }
      setTranscript(current);
      if (event.results[0].isFinal && current.trim()) {
        handleVoiceCommand(current);
      }
    };

    recognition.onerror = (event: any) => {
      setIsListening(false);
      setStatusText(`Voice error: ${event.error}`);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
  }, []);

  function speak(text: string) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }

  function addMessage(sender: 'user' | 'agent', text: string) {
    const newMsg: Message = {
      id: Math.random().toString(36).substring(2, 9),
      sender,
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages((prev) => [...prev, newMsg]);
  }

  function handleVoiceCommand(cmdText: string) {
    void executeCommand(cmdText, true);
  }

  async function executeCommand(cmdText: string, isVoice = false) {
    const text = cmdText.trim();
    if (!text) return;

    addMessage('user', text);
    setStatusText('Thinking…');
    setBusy(true);

    try {
      // All recall is answered from the database through /api/agent/memory, so
      // the assistant reports what is actually recorded rather than guessing.
      const reply = await interpretCommand(text);

      addMessage('agent', reply.text);
      if (reply.details && reply.details.length > 0) {
        addMessage('agent', reply.details.map((d) => `• ${d}`).join('\n'));
      }
      setStatusText(reply.text);
      if (isVoice) speak(reply.text);
      if (reply.navigateTo) router.push(reply.navigateTo);
    } catch {
      const failure = 'I could not complete that. The action was not performed.';
      addMessage('agent', failure);
      setStatusText(failure);
      if (isVoice) speak(failure);
    } finally {
      setBusy(false);
    }
  }

  function toggleListening() {
    if (!recognitionRef.current) {
      void executeCommand('System status', false);
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      setTranscript('');
      try {
        recognitionRef.current.start();
      } catch (err) {
        console.error(err);
      }
    }
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!textInput.trim()) return;
    void executeCommand(textInput, false);
    setTextInput('');
  }

  if (!enabled) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end pointer-events-auto font-sans">
      {/* Expanded AI Agent Window */}
      {isOpen && (
        <div className="mb-3 flex h-[420px] w-[360px] sm:w-[400px] flex-col overflow-hidden rounded-2xl border border-blue-500/30 bg-slate-900/95 p-0 shadow-2xl backdrop-blur-2xl text-white transition-all duration-300">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 bg-gradient-to-r from-navy via-slate-900 to-navy px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gold/20 text-gold border border-gold/40">
                <svg className="h-4 w-4 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold leading-none text-white">BrightScope AI Agent</h3>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-blue-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                  <span>{provider || 'Gemini 2.5 Flash'} Active</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
                title="Minimize AI Window"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
          </div>

          {/* Quick Action Pills */}
          <div className="flex gap-1.5 overflow-x-auto border-b border-white/10 bg-slate-950/60 p-2 text-[11px] scrollbar-none">
            <button
              type="button"
              onClick={() => executeCommand('Research Uganda')}
              className="shrink-0 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-red-300 hover:bg-red-500/20"
            >
              🇺🇬 Research Uganda
            </button>
            <button
              type="button"
              onClick={() => executeCommand('Show pipeline')}
              className="shrink-0 rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-blue-300 hover:bg-blue-500/20"
            >
              📊 Pipeline
            </button>
            <button
              type="button"
              onClick={() => executeCommand('Go to leads')}
              className="shrink-0 rounded-full border border-gold/30 bg-gold/10 px-2.5 py-1 text-gold hover:bg-gold/20"
            >
              🎯 Prospects
            </button>
            <button
              type="button"
              onClick={() => executeCommand('Show approvals')}
              className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-300 hover:bg-emerald-500/20"
            >
              ⚡ Approvals
            </button>
            <button
              type="button"
              onClick={() => executeCommand('System status')}
              className="shrink-0 rounded-full border border-purple-500/30 bg-purple-500/10 px-2.5 py-1 text-purple-300 hover:bg-purple-500/20"
            >
              ℹ️ Status
            </button>
          </div>

          {/* Chat Messages Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin scrollbar-thumb-white/10">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs shadow-sm ${
                    msg.sender === 'user'
                      ? 'bg-blue-600 text-white rounded-br-none'
                      : 'bg-slate-800 border border-white/10 text-slate-100 rounded-bl-none'
                  }`}
                >
                  {/* Replies list findings and blockers one per line. */}
                  <span className="whitespace-pre-line">{msg.text}</span>
                </div>
                <span className="mt-1 px-1 text-[10px] text-slate-400">{msg.timestamp}</span>
              </div>
            ))}

            {isListening && (
              <div className="flex items-center gap-2 rounded-xl bg-blue-500/10 border border-blue-500/30 p-2.5 text-xs text-blue-300 animate-pulse">
                <span className="h-2 w-2 rounded-full bg-blue-400 animate-ping" />
                <span>Listening... {transcript && `"${transcript}"`}</span>
              </div>
            )}

            {isSpeaking && (
              <div className="flex items-center gap-2 rounded-xl bg-gold/10 border border-gold/30 p-2.5 text-xs text-gold animate-pulse">
                <span className="h-2 w-2 rounded-full bg-gold animate-ping" />
                <span>Speaking response...</span>
              </div>
            )}

            <div ref={chatBottomRef} />
          </div>

          {/* Footer Input Bar */}
          <form onSubmit={handleFormSubmit} className="border-t border-white/10 bg-slate-950 p-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={toggleListening}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all ${
                isListening
                  ? 'bg-red-500 text-white animate-pulse shadow-lg shadow-red-500/40'
                  : isSpeaking
                  ? 'bg-gold text-slate-950 shadow-lg shadow-gold/40'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white border border-white/10'
              }`}
              title="Click to toggle Voice Assistant"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                />
              </svg>
            </button>

            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => {
                // Explicit rather than relying on implicit form submission:
                // the command box is the primary way to reach the assistant,
                // so pressing Enter must always send.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (textInput.trim() && !busy) {
                    void executeCommand(textInput, false);
                    setTextInput('');
                  }
                }
              }}
              disabled={busy}
              placeholder={busy ? 'Working…' : 'Ask AI Agent or command...'}
              className="flex-1 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none"
            />

            <button
              type="submit"
              disabled={!textInput.trim() || busy}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </form>
        </div>
      )}

      {/* Floating Bottom Widget Bar (Pill Widget) */}
      <div className="flex items-center gap-2 rounded-2xl border border-blue-500/30 bg-slate-900/95 p-1.5 shadow-2xl backdrop-blur-xl text-white">
        <button
          type="button"
          onClick={toggleListening}
          className={`flex h-9 w-9 items-center justify-center rounded-xl transition-all ${
            isListening
              ? 'bg-red-500 text-white animate-pulse shadow-lg shadow-red-500/40'
              : isSpeaking
              ? 'bg-gold text-slate-950 shadow-lg shadow-gold/40'
              : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-500 hover:to-indigo-500 shadow-md'
          }`}
          title="Toggle Voice Assistant"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
            />
          </svg>
        </button>

        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2.5 px-2 py-1 text-left text-xs hover:text-blue-300 transition-colors"
        >
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-white">AI Agent Widget</span>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
            </div>
            <span className="text-[10px] text-slate-400 max-w-[160px] sm:max-w-[220px] truncate">
              {statusText}
            </span>
          </div>

          <div className="ml-1 flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-slate-300">
            <svg
              className={`h-4 w-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </div>
        </button>
      </div>
    </div>
  );
}
