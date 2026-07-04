/**
 * useCodeModeChat — React chat state for a SandwichTS session
 * (SW-REACT-CHAT, SW-REACT-HIDE, SW-REACT-ABORT).
 *
 * Owns one CodeModeSession in a ref (created lazily, disposed on unmount) and
 * derives ALL chat state from session events — core never duplicates display
 * state, this hook never re-implements loop logic. Execution transcripts stay
 * wire-only inside the session; they surface here only via `lastTranscript`
 * (dev panels), never as chat messages.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    createCodeModeSession,
    isDevCodeRevealEnabled,
    type CodeModeEvent,
    type CodeModeSession,
    type CodeModeSessionConfig,
    type TranscriptEntry,
} from '@sandwichts/core';
import { toDisplayMessage, type DisplayMessage } from './messages';

export type ChatStatus = 'idle' | 'streaming' | 'executing' | 'error';

export interface UseCodeModeChatConfig extends CodeModeSessionConfig {
    /**
     * Reveal hidden code blocks (developer code peek). Defaults to the
     * localStorage `sandwichShowCode` flag.
     */
    devReveal?: boolean;
}

export interface CodeModeChat {
    messages: DisplayMessage[];
    /** The raw in-flight stream; render typing dots while !hasVisibleProse(streamingText). */
    streamingText: string;
    status: ChatStatus;
    /** True across the whole multi-iteration loop, not just one LLM call. */
    running: boolean;
    send: (text: string) => Promise<void>;
    abort: () => void;
    error: unknown;
    /** Latest script transcript for dev/observability panels. */
    lastTranscript: TranscriptEntry[] | null;
    devReveal: boolean;
}

export function useCodeModeChat(config: UseCodeModeChatConfig): CodeModeChat {
    const [messages, setMessages] = useState<DisplayMessage[]>([]);
    const [streamingText, setStreamingText] = useState('');
    const [status, setStatus] = useState<ChatStatus>('idle');
    const [running, setRunning] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const [lastTranscript, setLastTranscript] = useState<TranscriptEntry[] | null>(null);

    const devReveal = config.devReveal ?? isDevCodeRevealEnabled();

    const sessionRef = useRef<CodeModeSession | null>(null);
    const idRef = useRef(0);
    // Config values are captured at first use; the session is stable for the
    // component's lifetime (matching lm-ag-ui's client lifecycle).
    const configRef = useRef(config);
    configRef.current = config;

    const handleEvent = useCallback((e: CodeModeEvent) => {
        switch (e.type) {
            case 'iteration-start':
                setStreamingText('');
                setStatus('streaming');
                break;
            case 'text-delta':
                setStreamingText((prev) => prev + e.delta);
                break;
            case 'assistant-message':
                setStreamingText('');
                if (e.text) {
                    setMessages((prev) => [
                        ...prev,
                        toDisplayMessage(`asst_${++idRef.current}`, 'assistant', e.text),
                    ]);
                }
                break;
            case 'script-start':
                setStatus('executing');
                break;
            case 'script-end':
                setLastTranscript(e.transcript);
                setStatus('streaming');
                break;
            case 'final':
                setStatus('idle');
                break;
            default:
                break;
        }
        configRef.current.onEvent?.(e);
    }, []);

    const getSession = useCallback(() => {
        if (!sessionRef.current) {
            const { devReveal: _dev, onEvent: _onEvent, ...sessionConfig } = configRef.current;
            sessionRef.current = createCodeModeSession({
                ...sessionConfig,
                onEvent: handleEvent,
            });
        }
        return sessionRef.current;
    }, [handleEvent]);

    useEffect(() => () => {
        sessionRef.current?.dispose();
        sessionRef.current = null;
    }, []);

    const send = useCallback(async (text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        setError(null);
        setRunning(true);
        setStatus('streaming');
        setMessages((prev) => [...prev, toDisplayMessage(`user_${++idRef.current}`, 'user', trimmed)]);
        try {
            await getSession().send(trimmed);
        } catch (err) {
            setError(err);
            setStatus('error');
        } finally {
            setRunning(false);
            setStreamingText('');
            setStatus((prev) => (prev === 'error' ? prev : 'idle'));
        }
    }, [getSession]);

    const abort = useCallback(() => {
        sessionRef.current?.abort();
    }, []);

    return useMemo(() => ({
        messages,
        streamingText,
        status,
        running,
        send,
        abort,
        error,
        lastTranscript,
        devReveal,
    }), [messages, streamingText, status, running, send, abort, error, lastTranscript, devReveal]);
}
