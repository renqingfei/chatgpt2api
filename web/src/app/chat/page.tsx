"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, Copy, KeyRound, LoaderCircle, Radio, Send, Square, Terminal, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuthGuard } from "@/lib/use-auth-guard";
import { cn } from "@/lib/utils";

type ChatRole = "user" | "assistant";
type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  status?: "streaming" | "done" | "error";
};

const BASE_URL_STORAGE_KEY = "chatgpt2api:chat_base_url";
const MODEL_STORAGE_KEY = "chatgpt2api:chat_model";

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeBaseUrl(value: string) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function chatCompletionsEndpoint(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) {
    return "/v1/chat/completions";
  }
  return normalized.endsWith("/v1") ? `${normalized}/chat/completions` : `${normalized}/v1/chat/completions`;
}

function openAICompatibleBaseUrl(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) {
    return "/v1";
  }
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
}

function extractDelta(payload: string) {
  if (!payload || payload === "[DONE]") {
    return "";
  }
  const parsed = JSON.parse(payload) as {
    choices?: Array<{
      delta?: { content?: string };
      message?: { content?: string };
    }>;
  };
  const choice = parsed.choices?.[0];
  return String(choice?.delta?.content ?? choice?.message?.content ?? "");
}

function parseSseBlock(block: string) {
  return block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
}

function maskKey(value: string) {
  const key = String(value || "").trim();
  if (key.length <= 10) {
    return key ? "********" : "<api-key>";
  }
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

async function copyText(value: string, label: string) {
  await navigator.clipboard.writeText(value);
  toast.success(`${label} 已复制`);
}

function buildCurlSnippet(baseUrl: string, apiKey: string, model: string) {
  return `curl ${openAICompatibleBaseUrl(baseUrl)}/chat/completions \\
  -H "Authorization: Bearer ${maskKey(apiKey)}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model || "auto"}",
    "stream": true,
    "messages": [{"role": "user", "content": "Reply exactly: OK"}]
  }'`;
}

function buildOpenAISnippet(baseUrl: string, apiKey: string, model: string) {
  return `from openai import OpenAI

client = OpenAI(
    base_url="${openAICompatibleBaseUrl(baseUrl)}",
    api_key="${maskKey(apiKey)}",
)

stream = client.chat.completions.create(
    model="${model || "auto"}",
    messages=[{"role": "user", "content": "Reply exactly: OK"}],
    stream=True,
)

for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")`;
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex gap-3", isUser ? "justify-end" : "justify-start")}>
      {!isUser ? (
        <div className="mt-1 flex size-9 shrink-0 items-center justify-center rounded-2xl bg-stone-950 text-white shadow-sm">
          <Bot className="size-4" />
        </div>
      ) : null}
      <div
        className={cn(
          "max-w-[82%] whitespace-pre-wrap rounded-[28px] px-4 py-3 text-sm leading-7 shadow-sm sm:max-w-[72%]",
          isUser
            ? "bg-stone-950 text-white"
            : message.status === "error"
              ? "border border-rose-200 bg-rose-50 text-rose-700"
              : "border border-white/80 bg-white/90 text-stone-800",
        )}
      >
        {message.content || (message.status === "streaming" ? "正在等待上游返回..." : "")}
        {message.status === "streaming" ? <span className="ml-1 inline-block h-4 w-1 animate-pulse rounded bg-stone-400 align-middle" /> : null}
      </div>
      {isUser ? (
        <div className="mt-1 flex size-9 shrink-0 items-center justify-center rounded-2xl bg-white text-stone-800 shadow-sm ring-1 ring-stone-200">
          <UserRound className="size-4" />
        </div>
      ) : null}
    </div>
  );
}

export default function ChatPage() {
  const { isCheckingAuth, session } = useAuthGuard();
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("auto");
  const [prompt, setPrompt] = useState("Reply exactly: OK");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [copied, setCopied] = useState<"curl" | "python" | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const hasFilledSessionKeyRef = useRef(false);

  const endpoint = useMemo(() => chatCompletionsEndpoint(baseUrl), [baseUrl]);
  const clientBaseUrl = useMemo(() => openAICompatibleBaseUrl(baseUrl), [baseUrl]);
  const curlSnippet = useMemo(() => buildCurlSnippet(baseUrl, apiKey, model), [apiKey, baseUrl, model]);
  const openaiSnippet = useMemo(() => buildOpenAISnippet(baseUrl, apiKey, model), [apiKey, baseUrl, model]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    setBaseUrl(window.localStorage.getItem(BASE_URL_STORAGE_KEY) || window.location.origin);
    setModel(window.localStorage.getItem(MODEL_STORAGE_KEY) || "auto");
  }, []);

  useEffect(() => {
    if (!session?.key || hasFilledSessionKeyRef.current) {
      return;
    }
    hasFilledSessionKeyRef.current = true;
    setApiKey(session.key);
  }, [session?.key]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (baseUrl.trim()) {
      window.localStorage.setItem(BASE_URL_STORAGE_KEY, baseUrl.trim());
    }
  }, [baseUrl]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(MODEL_STORAGE_KEY, model.trim() || "auto");
  }, [model]);

  useEffect(() => {
    viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const stopStreaming = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  };

  const sendMessage = async () => {
    const text = prompt.trim();
    const key = apiKey.trim();
    if (!text) {
      toast.error("先输入一句话");
      return;
    }
    if (!key) {
      toast.error("API Key 不能为空");
      return;
    }

    const userMessage: ChatMessage = { id: createId(), role: "user", content: text, status: "done" };
    const assistantId = createId();
    const history = messages
      .filter((message) => message.content.trim() && message.status !== "error")
      .map((message) => ({ role: message.role, content: message.content }));
    const nextMessages = [...messages, userMessage, { id: assistantId, role: "assistant" as const, content: "", status: "streaming" as const }];
    const controller = new AbortController();

    abortRef.current = controller;
    setMessages(nextMessages);
    setPrompt("");
    setIsStreaming(true);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model.trim() || "auto",
          stream: true,
          messages: [...history, { role: "user", content: text }],
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const errorText = await response.text().catch(() => "");
        throw new Error(errorText || `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || "";

        for (const block of blocks) {
          const payload = parseSseBlock(block);
          if (!payload) {
            continue;
          }
          if (payload === "[DONE]") {
            await reader.cancel().catch(() => undefined);
            break;
          }
          const delta = extractDelta(payload);
          if (!delta) {
            continue;
          }
          assistantText += delta;
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId ? { ...message, content: assistantText, status: "streaming" } : message,
            ),
          );
        }
      }

      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? { ...message, content: assistantText || message.content || "上游返回为空", status: "done" }
            : message,
        ),
      );
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId ? { ...message, content: message.content || "已停止生成", status: "done" } : message,
          ),
        );
        return;
      }
      const message = error instanceof Error ? error.message : "请求失败";
      setMessages((current) =>
        current.map((item) => (item.id === assistantId ? { ...item, content: message, status: "error" } : item)),
      );
      toast.error(message);
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
    }
  };

  const handleCopy = async (type: "curl" | "python", value: string) => {
    await copyText(value, type === "curl" ? "cURL 示例" : "Python 示例");
    setCopied(type);
    window.setTimeout(() => setCopied(null), 1200);
  };

  if (isCheckingAuth || !session) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return (
    <section className="grid min-h-0 flex-1 grid-cols-1 gap-4 pb-6 lg:grid-cols-[minmax(0,1fr)_420px]">
      <Card className="min-h-[calc(100dvh-8rem)] overflow-hidden border-white/80 bg-white/55 shadow-[0_28px_90px_-45px_rgba(15,23,42,0.36)]">
        <CardHeader className="border-b border-white/70 bg-white/60 px-5 py-5 backdrop-blur sm:px-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
                <Radio className="size-3.5" />
                SSE Chat Completions
              </div>
              <CardTitle className="text-2xl font-black tracking-tight text-stone-950 sm:text-3xl">对话中转测试台</CardTitle>
              <CardDescription className="mt-2 text-sm leading-6 text-stone-500">
                直接调用本项目的 OpenAI-compatible `/v1/chat/completions`，底层走本地号池里的 ChatGPT Web token。
              </CardDescription>
            </div>
            <Button variant="outline" className="rounded-2xl bg-white/80" onClick={() => setMessages([])} disabled={isStreaming || messages.length === 0}>
              清空对话
            </Button>
          </div>
        </CardHeader>

        <CardContent className="flex h-[calc(100dvh-17rem)] min-h-[420px] flex-col gap-4 p-4 sm:p-6">
          <div ref={viewportRef} className="hide-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto rounded-[32px] border border-white/80 bg-stone-50/70 p-4 shadow-inner">
            {messages.length === 0 ? (
              <div className="flex h-full min-h-[320px] flex-col items-center justify-center text-center">
                <div className="mb-5 flex size-16 items-center justify-center rounded-[28px] bg-stone-950 text-white shadow-[0_20px_45px_-20px_rgba(15,23,42,0.6)]">
                  <Bot className="size-7" />
                </div>
                <h2 className="text-xl font-bold text-stone-950">先发一句最小测试</h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-stone-500">
                  默认 prompt 是 `Reply exactly: OK`。能流式返回，就说明别人按右边参数接入也能跑。
                </p>
              </div>
            ) : (
              messages.map((message) => <MessageBubble key={message.id} message={message} />)
            )}
          </div>

          <div className="rounded-[30px] border border-white/80 bg-white/85 p-3 shadow-[0_18px_55px_-35px_rgba(15,23,42,0.45)]">
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder="输入消息，Ctrl/⌘ + Enter 发送"
              className="min-h-24 resize-none border-0 bg-transparent px-3 py-2 shadow-none focus-visible:ring-0"
              disabled={isStreaming}
            />
            <div className="flex flex-col gap-2 border-t border-stone-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="px-2 text-xs text-stone-400">Ctrl/⌘ + Enter 发送 · 当前 endpoint: {endpoint}</span>
              <div className="flex gap-2">
                {isStreaming ? (
                  <Button className="rounded-2xl bg-rose-600 text-white hover:bg-rose-700" onClick={stopStreaming}>
                    <Square className="size-4" />
                    停止
                  </Button>
                ) : (
                  <Button className="rounded-2xl bg-stone-950 text-white" onClick={() => void sendMessage()}>
                    <Send className="size-4" />
                    发送
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <aside className="space-y-4">
        <Card className="border-white/80 bg-white/70">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <KeyRound className="size-5" />
              接入参数
            </CardTitle>
            <CardDescription>别人接入时，本质就填这两样。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Base URL / 项目地址</span>
              <Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="http://127.0.0.1:3000" />
              <p className="text-xs leading-5 text-stone-500">
                页面里可以填项目根地址；OpenAI 客户端里推荐填：<code className="rounded bg-stone-100 px-1">{clientBaseUrl}</code>
              </p>
            </label>

            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">API Key</span>
              <Input value={apiKey} onChange={(event) => setApiKey(event.target.value)} type="password" placeholder="chatgpt2api 或用户 Key" />
              <p className="text-xs leading-5 text-stone-500">默认使用当前登录 Key。对外分发建议在「设置 → 用户 Key」里单独创建。</p>
            </label>

            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Model</span>
              <Input value={model} onChange={(event) => setModel(event.target.value)} placeholder="auto" />
              <p className="text-xs leading-5 text-stone-500">文本建议先用 <code className="rounded bg-stone-100 px-1">auto</code>，实际能力以号池账号返回为准。</p>
            </label>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-stone-950 bg-stone-950 text-white">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Terminal className="size-5" />
              怎么给别人说
            </CardTitle>
            <CardDescription className="text-stone-300">别说 Codex。就说 OpenAI-compatible ChatGPT Web relay。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-stone-200">
            <div className="rounded-2xl bg-white/8 p-4">
              <div className="mb-1 text-xs font-bold text-stone-400">接入字段</div>
              <p>
                Base URL 填 <code>{clientBaseUrl}</code>，API Key 填本项目登录密钥或用户 Key，模型先填 <code>{model || "auto"}</code>。
              </p>
            </div>
            <div className="rounded-2xl bg-white/8 p-4">
              <div className="mb-1 text-xs font-bold text-stone-400">能力边界</div>
              <p>这是 ChatGPT Web 对话中转，不是 Codex OAuth。注册号能不能用某个模型，以本页面流式返回为准。</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/70">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">示例请求</CardTitle>
            <CardDescription>复制时会隐藏 API Key，自己发给别人时换成真实 key。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-2xl bg-stone-950 p-4 text-xs leading-5 text-stone-100">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-semibold text-stone-300">cURL</span>
                <button className="inline-flex items-center gap-1 text-stone-400 hover:text-white" onClick={() => void handleCopy("curl", curlSnippet)}>
                  {copied === "curl" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  复制
                </button>
              </div>
              <pre className="hide-scrollbar overflow-x-auto whitespace-pre-wrap">{curlSnippet}</pre>
            </div>

            <div className="rounded-2xl bg-stone-950 p-4 text-xs leading-5 text-stone-100">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-semibold text-stone-300">Python OpenAI SDK</span>
                <button className="inline-flex items-center gap-1 text-stone-400 hover:text-white" onClick={() => void handleCopy("python", openaiSnippet)}>
                  {copied === "python" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  复制
                </button>
              </div>
              <pre className="hide-scrollbar overflow-x-auto whitespace-pre-wrap">{openaiSnippet}</pre>
            </div>
          </CardContent>
        </Card>
      </aside>
    </section>
  );
}
