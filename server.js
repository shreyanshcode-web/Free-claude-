require("dotenv").config();

const express = require("express");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "50mb" }));

let CURRENT_MODEL = "qwen/qwen3-next-80b-a3b-instruct:free";

app.post("/v1/messages", async (req, res) => {
  console.log("Request received");

  try {
    const lastMessage = req.body.messages?.slice(-1)[0];
    const userText = lastMessage?.content?.[0]?.text || "";

    console.log("User input:", userText);

    if (userText.toLowerCase().startsWith("model ")) {
      const newModel = userText.slice(6).trim();

      if (!newModel) {
        return res.json({
          id: "msg_" + Date.now(),
          type: "message",
          role: "assistant",
          content: [
            {
              type: "text",
              text: "Usage:\nmodel <model-name>\nExample:\nmodel qwen/qwen3-next-80b-a3b-instruct:free"
            }
          ],
          model: CURRENT_MODEL,
          stop_reason: "end_turn"
        });
      }

      CURRENT_MODEL = newModel;
      console.log("Model switched to:", CURRENT_MODEL);

      return res.json({
        id: "msg_" + Date.now(),
        type: "message",
        role: "assistant",
        content: [
          {
            type: "text",
            text: `Model switched to:\n${CURRENT_MODEL}`
          }
        ],
        model: CURRENT_MODEL,
        stop_reason: "end_turn"
      });
    }

    let rawMessages = req.body.messages || [];
    rawMessages = rawMessages.slice(-5);

    const messages = rawMessages
      .filter((message) => message.role === "user")
      .map((message) => {
        const text = message.content?.[0]?.text || "";

        if (text.includes("<system-reminder>")) return null;
        if (text.includes("<local-command-caveat>")) return null;
        if (text.trim() === "") return null;

        return {
          role: "user",
          content: text
        };
      })
      .filter(Boolean);

    if (messages.length === 0) {
      return res.json({
        id: "msg_" + Date.now(),
        type: "message",
        role: "assistant",
        content: [
          {
            type: "text",
            text: "No valid user input detected."
          }
        ],
        model: CURRENT_MODEL,
        stop_reason: "end_turn"
      });
    }

    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error("Missing OPENROUTER_API_KEY in environment variables.");
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: CURRENT_MODEL,
        messages
      })
    });

    const data = await response.json();

    console.log("OpenRouter response:", JSON.stringify(data).slice(0, 200));

    if (!response.ok) {
      const message = data?.error?.message || `OpenRouter request failed with status ${response.status}.`;
      throw new Error(message);
    }

    if (!data || !data.choices || !data.choices[0]) {
      console.error("Bad response:", data);

      return res.json({
        id: "msg_" + Date.now(),
        type: "message",
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Model failed or returned an empty response."
          }
        ],
        model: CURRENT_MODEL,
        stop_reason: "end_turn"
      });
    }

    const reply = data.choices[0].message?.content || "No response content returned by the model.";

    console.log("Response sent");

    return res.json({
      id: "msg_" + Date.now(),
      type: "message",
      role: "assistant",
      content: [
        {
          type: "text",
          text: reply
        }
      ],
      model: CURRENT_MODEL,
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0
      }
    });
  } catch (err) {
    console.error("Error:", err.message);

    return res.status(500).json({
      id: "error_" + Date.now(),
      type: "error",
      error: {
        type: "api_error",
        message: err.message
      }
    });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy running at http://localhost:${PORT}`);
  console.log("Default model:", CURRENT_MODEL);
});
