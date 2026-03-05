'use client';

import { useState, useRef, useEffect, FormEvent } from 'react';
import { ResultsTable } from './ResultsTable';

interface QueryPlan {
  description: string;
  tablesUsed: string[];
  estimatedComplexity: 'low' | 'medium' | 'high';
}

interface QueryMetadata {
  tablesUsed: string[];
  rowCount: number;
  executionTimeMs: number;
  cached: boolean;
}

interface ClarificationRequest {
  message: string;
  options: string[];
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  queryPlan?: QueryPlan;
  sql?: string;
  results?: Record<string, unknown>[];
  narrative?: string;
  explanation?: string;
  metadata?: QueryMetadata;
  followUpSuggestions?: string[];
  clarificationNeeded?: ClarificationRequest;
  loading?: boolean;
  error?: string;
}

const SAMPLE_PROMPTS = [
  "What can Oliver Smith access across all providers?",
  "Who has admin access to account nw-prod-01?",
  "Show users who haven't logged in for 90 days but still have admin access",
  "Who is in the Security-Admins group?",
  "Find departed employees who still have active entitlements",
];

export function ChatInterface() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showSql, setShowSql] = useState<Record<string, boolean>>({});
  const [showLineage, setShowLineage] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e?: FormEvent, overrideQuestion?: string) => {
    e?.preventDefault();
    const question = overrideQuestion || input.trim();
    if (!question || isLoading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: question,
    };

    const loadingMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      loading: true,
    };

    setMessages(prev => [...prev, userMsg, loadingMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(errorData.error || `HTTP ${res.status}`);
      }

      const data = await res.json();

      const assistantMsg: ChatMessage = {
        id: data.id || crypto.randomUUID(),
        role: 'assistant',
        content: data.narrative || '',
        queryPlan: data.queryPlan,
        sql: data.sql,
        results: data.results,
        narrative: data.narrative,
        explanation: data.explanation,
        metadata: data.metadata,
        followUpSuggestions: data.followUpSuggestions,
        clarificationNeeded: data.clarificationNeeded,
      };

      setMessages(prev => prev.slice(0, -1).concat(assistantMsg));
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        error: err instanceof Error ? err.message : 'An unexpected error occurred',
      };
      setMessages(prev => prev.slice(0, -1).concat(errorMsg));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const toggleSql = (id: string) => setShowSql(prev => ({ ...prev, [id]: !prev[id] }));
  const toggleLineage = (id: string) => setShowLineage(prev => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="flex flex-col h-full max-w-5xl mx-auto">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-16">
            <h2 className="text-2xl font-semibold text-ons-grey-5 mb-2">
              Cloud Identity Intelligence
            </h2>
            <p className="text-ons-grey-35 mb-8">
              Ask questions about cloud access, identities, and entitlements in plain English.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SAMPLE_PROMPTS.map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => handleSubmit(undefined, prompt)}
                  className="px-3 py-2 text-sm bg-ons-grey-100 border border-ons-grey-100 rounded-lg hover:border-ons-sky-blue hover:bg-ons-ocean-blue/20 transition text-left max-w-xs text-ons-grey-15"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-3xl rounded-xl px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-ons-blue text-ons-text-primary'
                  : 'bg-ons-bg-elevated/80 border border-ons-border text-ons-text-headline shadow-sm'
              }`}
            >
              {/* User message */}
              {msg.role === 'user' && <p>{msg.content}</p>}

              {/* Loading state */}
              {msg.loading && (
                <div className="flex items-center gap-2 text-ons-grey-35">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-ons-sky-blue rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-ons-sky-blue rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-ons-sky-blue rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-sm">Analysing your question...</span>
                </div>
              )}

              {/* Error state */}
              {msg.error && (
                <div className="text-ons-ruby-red bg-ons-ruby-red/10 rounded-lg p-3 border border-ons-ruby-red/20">
                  <p className="font-medium">Something went wrong</p>
                  <p className="text-sm mt-1">{msg.error}</p>
                </div>
              )}

              {/* Clarification needed */}
              {msg.clarificationNeeded && (
                <div>
                  <p className="mb-3">{msg.clarificationNeeded.message}</p>
                  <div className="flex flex-wrap gap-2">
                    {msg.clarificationNeeded.options.map((opt, i) => {
                      const text = typeof opt === 'string'
                        ? opt
                        : (opt as Record<string, unknown>).label as string ?? String(opt);
                      return (
                        <button
                          key={i}
                          onClick={() => handleSubmit(undefined, text)}
                          className="px-3 py-1.5 text-sm bg-ons-ocean-blue/20 border border-ons-ocean-blue/40 rounded-md hover:bg-ons-ocean-blue/30 transition"
                        >
                          {text}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Narrative */}
              {msg.narrative && !msg.loading && !msg.error && (
                <div>
                  {/* Query plan badge */}
                  {msg.queryPlan && (
                    <div className="text-xs text-ons-grey-35 mb-2 flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                        msg.queryPlan.estimatedComplexity === 'low' ? 'bg-ons-leaf-green/10 text-ons-spring-green border border-ons-leaf-green/20' :
                        msg.queryPlan.estimatedComplexity === 'medium' ? 'bg-ons-jaffa-orange/10 text-ons-jaffa-orange border border-ons-jaffa-orange/20' :
                        'bg-ons-ruby-red/10 text-ons-ruby-red border border-ons-ruby-red/20'
                      }`}>
                        {msg.queryPlan.estimatedComplexity}
                      </span>
                      <span>{msg.queryPlan.description}</span>
                    </div>
                  )}

                  <p className="mb-3">{msg.narrative}</p>

                  {/* Explanation */}
                  {msg.explanation && (
                    <div className="text-sm text-ons-grey-35 bg-ons-grey-100/50 rounded-lg p-3 mb-3 border border-ons-grey-100">
                      <span className="font-medium">Why: </span>
                      {msg.explanation}
                    </div>
                  )}

                  {/* Results table */}
                  {msg.results && msg.results.length > 0 && (
                    <div className="mb-3">
                      <ResultsTable data={msg.results} />
                    </div>
                  )}

                  {/* Metadata + toggles */}
                  {msg.metadata && (
                    <div className="flex items-center gap-3 text-xs text-ons-grey-75 mb-2">
                      <span>{msg.metadata.rowCount} row{msg.metadata.rowCount === 1 ? '' : 's'}</span>
                      <span>{msg.metadata.executionTimeMs}ms</span>
                      {msg.metadata.cached && <span className="text-ons-sky-blue">cached</span>}
                      <button
                        onClick={() => toggleSql(msg.id)}
                        className="text-ons-sky-blue hover:text-ons-aqua-teal transition"
                      >
                        {showSql[msg.id] ? 'Hide SQL' : 'Show SQL'}
                      </button>
                      <button
                        onClick={() => toggleLineage(msg.id)}
                        className="text-ons-sky-blue hover:text-ons-aqua-teal transition"
                      >
                        {showLineage[msg.id] ? 'Hide Lineage' : 'Data Lineage'}
                      </button>
                    </div>
                  )}

                  {/* SQL code block */}
                  {showSql[msg.id] && msg.sql && (
                    <pre className="bg-ons-night-blue text-ons-spring-green text-xs p-3 rounded-lg overflow-x-auto mb-2">
                      <code>{msg.sql}</code>
                    </pre>
                  )}

                  {/* Data lineage */}
                  {showLineage[msg.id] && msg.metadata?.tablesUsed && (
                    <div className="text-xs bg-ons-grey-100/50 p-3 rounded-lg mb-2 border border-ons-grey-100">
                      <span className="font-medium">Tables queried: </span>
                      {msg.metadata.tablesUsed.map((t, i) => (
                        <span key={t}>
                          <code className="bg-ons-grey-100 px-1.5 py-0.5 rounded text-ons-grey-15">{t}</code>
                          {i < msg.metadata!.tablesUsed.length - 1 ? ' \u2192 ' : ''}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Follow-up suggestions */}
                  {msg.followUpSuggestions && msg.followUpSuggestions.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {msg.followUpSuggestions.map((suggestion, i) => {
                        const text = typeof suggestion === 'string'
                          ? suggestion
                          : (suggestion as Record<string, unknown>).label as string ?? String(suggestion);
                        return (
                          <button
                            key={i}
                            onClick={() => handleSubmit(undefined, text)}
                            className="px-2.5 py-1 text-xs bg-ons-ocean-blue/20 border border-ons-ocean-blue/40 rounded-full hover:bg-ons-ocean-blue/30 transition text-ons-sky-blue"
                          >
                            {text}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-ons-grey-100 bg-ons-grey-100/80 backdrop-blur-sm p-4">
        <form onSubmit={handleSubmit} className="flex gap-2 max-w-3xl mx-auto">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about cloud access, identities, or entitlements..."
            className="flex-1 resize-none rounded-lg border border-ons-grey-100 bg-ons-black px-4 py-2.5 text-sm text-ons-grey-15 placeholder:text-ons-grey-75 focus:outline-none focus:ring-2 focus:ring-ons-sky-blue focus:border-transparent"
            rows={1}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-4 py-2.5 bg-ons-blue text-ons-text-primary rounded-lg text-sm font-medium hover:bg-ons-blue/80 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {isLoading ? 'Thinking...' : 'Ask'}
          </button>
        </form>
      </div>
    </div>
  );
}
