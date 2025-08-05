require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const Membership = require("./membership");
const categorizedQuestions = require("./questions");
const fs = require("fs");

const token = process.env.BOT_TOKEN;
const sponsors = process.env.SPONSORS;
const bot = new TelegramBot(token, { polling: true });
const membership = new Membership(sponsors);
const userStates = {};
const userResults = {};
const lastMessages = {}; // Stores the message ID of the last sent category menu
const lastCommandMessages = {}; // Stores message IDs of bot's responses to commands like /start or /categories
const finalResultMessages = {}; // Stores the message ID of the final quiz result message
let qt = 0;
const LOG_FILE = "bot_starts.log";

function logBotStart(chatId, username, msg) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] User ${username} (ID: ${chatId}) started the bot.\n`;
  fs.appendFile(LOG_FILE, logEntry, (err) => {
    if (err) {
      console.error("Failed to write to log file:", err);
    }
  });
}

const QUIZ_TITLES = [
  { min: 0, max: 4, title: "📚 Սկսնակ" },
  { min: 5, max: 9, title: "💗 Ացավ մակարդակ" },
  { min: 10, max: 14, title: "💙 Հետաքրքրված ֆուտբոլասեր" },
  { min: 15, max: 19, title: "💕 Միջին մակարդակ" },
  { min: 20, max: 24, title: "🎯 Անչափ տեղեկացված" },
  { min: 25, max: 99, title: "🥇 Գիտակ" },
  { min: 100, max: Infinity, title: "🏆 Վարպետ" },
];

const categoryNames = {
  players: "⚽ Ֆուտբոլիստներ",
  coaches: "👔 Մարզիչներ",
  logos: "🏷️ Թիմերի լոգոներ",
  goalkeepers: "🧤 Դարպասապահներ",
  armenianFootballers: "🇦🇲 Հայ ֆուտբոլիստներ",
  legends: "👑 Լեգենդներ",
  spanish_players: "🇪🇸 Իսպանացիներ",
  english_players: "🇬🇧 Անգլիացիներ",
  italian_players: "🇮🇹 Իտալացիներ",
};

function sendSubscriptionPrompt(chatId) {
  return bot.sendMessage(
    chatId,
    "🛑 Խաղը շարունակելու համար բաժանորդագրվեք մեր ալիքին",
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "📢 Բաժանորդագրվել ալիքին",
              url: `${"https://t.me/+ySkPmDqPlcpmYzZi"}`,
            },
          ],
          [
            {
              text: "✅ Ստուգել բաժանորդագրությունը",
              callback_data: "check_subscription",
            },
          ],
        ],
      },
    },
  );
}

function sendCategoryMenu(chatId) {
  const getLabel = (key, label) => {
    const result = userResults[chatId]?.[key];
    return result ? `${label} (${result.score}/${result.total})` : label;
  };

  return bot
    .sendMessage(chatId, "⚽ Ընտրիր վիկտորինայի կատեգորիան", {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: getLabel("players", "⚽ Ֆուտբոլիստներ"),
              callback_data: "category_players",
            },
          ],
          [
            {
              text: getLabel("coaches", "👔 Մարզիչներ"),
              callback_data: "category_coaches",
            },
          ],
          [
            {
              text: getLabel("logos", "🏷️ Թիմերի լոգոներ"),
              callback_data: "category_logos",
            },
          ],
          [
            {
              text: getLabel("goalkeepers", "🧤 Դարպասապահներ"),
              callback_data: "category_goalkeepers",
            },
          ],
          [
            {
              text: getLabel("armenianFootballers", "🇦🇲 Հայ ֆուտբոլիստներ"),
              callback_data: "category_armenianFootballers",
            },
          ],
          [
            {
              text: getLabel("legends", "👑 Լեգենդներ"),
              callback_data: "category_legends",
            },
          ],
          [
            {
              text: getLabel("spanish_players", "🇪🇸 Իսպանացիներ"),
              callback_data: "category_spanish_players",
            },
          ],
          [
            {
              text: getLabel("english_players", "🇬🇧 Անգլիացիներ"),
              callback_data: "category_english_players",
            },
          ],
          [
            {
              text: getLabel("italian_players", "🇮🇹 Իտալացիներ"),
              callback_data: "category_italian_players",
            },
          ],
        ],
      },
    })
    .then((msg) => {
      // Store the message ID for the category menu
      lastMessages[chatId] = msg.message_id;
      return msg; // Return the message object to be used by the caller if needed
    });
}

function clearQuestionOnly(chatId) {
  if (userStates[chatId]?.lastMessageId) {
    bot.deleteMessage(chatId, userStates[chatId].lastMessageId).catch((err) => {
      if (!err.message.includes("message to delete not found")) {
        console.error("Error deleting question message:", err);
      }
    });
    userStates[chatId].lastMessageId = null;
  }
}

// Updated clearAllMessages function to delete everything except command responses
function clearAllMessages(chatId) {
  // Clear the current question message (if any)
  clearQuestionOnly(chatId);

  // Clear the category menu message (if any)
  if (lastMessages[chatId]) {
    bot.deleteMessage(chatId, lastMessages[chatId]).catch((err) => {
      if (!err.message.includes("message to delete not found")) {
        console.error("Error deleting category menu message:", err);
      }
    });
    delete lastMessages[chatId];
  }

  // Clear the final result message (if any)
  if (finalResultMessages[chatId]) {
    bot.deleteMessage(chatId, finalResultMessages[chatId]).catch((err) => {
      if (!err.message.includes("message to delete not found")) {
        console.error("Error deleting final result message:", err);
      }
    });
    delete finalResultMessages[chatId];
  }

  // User state should be cleared to reset the quiz progress
  delete userStates[chatId];
  // userResults are intentionally not cleared as they store past quiz scores
}

bot.onText(/\/start/, async (msg) => {
  qt++;
  console.log(
    msg.from.first_name,
    "________",
    msg.from.username,
    "________",
    msg.from.id,
    "-------",
    qt,
  );
  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name || `User_${chatId}`;

  // Clear any previous /start command *response* message if it exists

  const logMessage = `Նոր օգտատեր է սկսել բոտը։
Անուն: ${msg.from.first_name}
Username: @${msg.from.username}
ID: ${msg.from.id}
Ընդհանուր քանակ: ${qt}`;

  bot.sendMessage(-4804292319, logMessage);
  if (lastCommandMessages[chatId]?.start) {
    bot
      .deleteMessage(chatId, lastCommandMessages[chatId].start)
      .catch((err) => {
        if (!err.message.includes("message to delete not found")) {
          console.error(
            "Error deleting previous /start response message:",
            err,
          );
        }
      });
  }
  // Clear any previous /categories command *response* message if it exists
  if (lastCommandMessages[chatId]?.categories) {
    bot
      .deleteMessage(chatId, lastCommandMessages[chatId].categories)
      .catch((err) => {
        if (!err.message.includes("message to delete not found")) {
          console.error(
            "Error deleting previous /categories response message:",
            err,
          );
        }
      });
  }

  logBotStart(chatId, username, msg);

  const isMember = await membership.verify(bot, chatId);
  clearAllMessages(chatId); // Clear all old messages (except command responses)

  const sentMsg = await bot.sendMessage(
    chatId,
    `🎉 Բարի գալուստ Սպորտային խաղեր բոտ: 📊
🤔 Դու պատրաստ ե՞ս փորձել քո գիտելիքները ֆուտբոլից։
📌 Ընտրիր կատեգորիան եվ փորձիր ուժերդ: ⚽️`,
  );
  // Store the message ID for this /start command response
  lastCommandMessages[chatId] = lastCommandMessages[chatId] || {};
  lastCommandMessages[chatId].start = sentMsg.message_id;

  if (!isMember) {
    return sendSubscriptionPrompt(chatId);
  }
  sendCategoryMenu(chatId);
});

bot.onText(/\/categories/, async (msg) => {
  const chatId = msg.chat.id;

  // Clear any previous /categories command *response* message if it exists
  if (lastCommandMessages[chatId]?.categories) {
    bot
      .deleteMessage(chatId, lastCommandMessages[chatId].categories)
      .catch((err) => {
        if (!err.message.includes("message to delete not found")) {
          console.error(
            "Error deleting previous /categories response message:",
            err,
          );
        }
      });
  }
  // Clear any previous /start command *response* message if it exists
  if (lastCommandMessages[chatId]?.start) {
    bot
      .deleteMessage(chatId, lastCommandMessages[chatId].start)
      .catch((err) => {
        if (!err.message.includes("message to delete not found")) {
          console.error(
            "Error deleting previous /start response message:",
            err,
          );
        }
      });
  }

  const isMember = await membership.verify(bot, chatId);
  clearAllMessages(chatId); // Clear all old messages (except command responses)
  if (!isMember) {
    return sendSubscriptionPrompt(chatId);
  }

  // Await the sendCategoryMenu and then use the ID it stored in lastMessages[chatId]
  const sentMenuMsg = await sendCategoryMenu(chatId);
  // Store the message ID for this /categories command response
  lastCommandMessages[chatId] = lastCommandMessages[chatId] || {};
  lastCommandMessages[chatId].categories = sentMenuMsg.message_id; // Corrected: use the message_id from the resolved promise
});

bot.on("callback_query", async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  // Answer the callbackQuery immediately to reduce perceived lag
  await bot
    .answerCallbackQuery(callbackQuery.id)
    .catch((err) => console.error("Error answering callback query:", err));

  const isMember = await membership.verify(bot, chatId);
  if (!isMember) {
    return sendSubscriptionPrompt(chatId);
  }

  if (data === "check_subscription") {
    clearAllMessages(chatId); // Clear everything except command responses
    return sendCategoryMenu(chatId);
  }

  if (data === "show_categories") {
    clearAllMessages(chatId); // Clear everything except command responses
    return sendCategoryMenu(chatId);
  }

  if (data.startsWith("category_")) {
    clearAllMessages(chatId); // Clear all messages before starting a new quiz

    const category = data.replace("category_", "");
    let questions = categorizedQuestions?.[category];
    if (!questions) {
      return bot.sendMessage(chatId, "❌ Այս կատեգորիան դեռ հասանելի չէ։");
    }
    questions = shuffleArray(questions);

    userStates[chatId] = {
      score: 0,
      current: 0,
      finished: false,
      category,
      questions,
      total: questions?.length,
      lastMessageId: null, // Will store the ID of the current question message
      answers: new Array(questions?.length).fill(null),
      manualNav: false,
    };

    return sendQuestion(chatId);
  }

  const state = userStates[chatId];
  if (!state) return; // If no state, ignore callback (e.g., old message callback)

  if (data === "go_back") {
    if (state.current > 0) {
      state.current--;
      state.manualNav = true;
      return sendQuestion(chatId);
    } else {
      return bot.answerCallbackQuery(callbackQuery.id, {
        text: "Սա առաջին հարցն է։",
        show_alert: true,
      });
    }
  }

  if (data === "go_next" || data === "next_question") {
    // Prevent going next if the current question hasn't been answered
    if (state.answers[state.current] === null) {
      return bot.answerCallbackQuery(callbackQuery.id, {
        text: "Խնդրում ենք նախ պատասխանել ընթացիկ հարցին։",
        show_alert: true,
      });
    }

    if (state.current < state.total - 1) {
      state.current++;
      state.manualNav = data === "go_next"; // manualNav is true for "go_next" button
      return sendQuestion(chatId);
    } else {
      // If it's the last question and it's been answered
      return showFinalResult(chatId, state.score, state.total);
    }
  }

  // If the pressed button is an answer to a question
  return handleAnswer(callbackQuery, chatId, data);
});

async function sendQuestion(chatId) {
  const isMember = await membership.verify(bot, chatId);
  if (!isMember) return sendSubscriptionPrompt(chatId);

  const state = userStates[chatId];
  const question = state.questions?.[state.current];
  const userAnswer = state.answers[state.current];

  let keyboard = [];
  if (userAnswer !== null) {
    // If the user has answered, show correct/incorrect answers
    keyboard = question.opts.map((opt, i) => {
      const prefix =
        i === question?.ans ? "✅ " : i === userAnswer ? "❌ " : "";
      return [{ text: `${prefix}${opt}`, callback_data: "ignore" }];
    });

    const nextButtons = [];
    if (state.current > 0)
      nextButtons.push({ text: "⬅️ Նախորդը", callback_data: "go_back" });
    if (state.current < state.total - 1) {
      nextButtons.push({
        text: "Հաջորդը ➡️",
        callback_data: "next_question",
      });
    } else {
      nextButtons.push({ text: "🏁 Ավարտել", callback_data: "next_question" });
    }
    if (nextButtons.length) keyboard.push(nextButtons);
  } else {
    // If the user hasn't answered yet, show selectable options
    keyboard = question.opts.map((opt, i) => [
      { text: opt, callback_data: i.toString() },
    ]);
  }

  const caption = `❓ Հարց ${state.current + 1}/${state.total}\n${question.q}`;
  const options = {
    chat_id: chatId,
    message_id: state.lastMessageId,
    reply_markup: { inline_keyboard: keyboard },
    parse_mode: "HTML",
  };

  try {
    if (state.lastMessageId) {
      // If there's an existing message, try to edit it
      if (question.image) {
        await bot.editMessageMedia(
          { type: "photo", media: question.image, caption },
          options,
        );
      } else {
        await bot.editMessageText(caption, options);
      }
    } else {
      // If no existing message, send a new one
      if (question.image) {
        const msg = await bot.sendPhoto(chatId, question.image, {
          caption,
          reply_markup: { inline_keyboard: keyboard }, // Corrected property name from 'inline' to 'inline_keyboard'
          parse_mode: "HTML",
        });
        state.lastMessageId = msg.message_id;
      } else {
        const msg = await bot.sendMessage(chatId, caption, {
          reply_markup: { inline_keyboard: keyboard },
          parse_mode: "HTML",
        });
        state.lastMessageId = msg.message_id;
      }
    }
  } catch (err) {
    if (
      !err.message.includes("message is not modified") &&
      !err.message.includes("canceled by new editMessageMedia request") &&
      !err.message.includes("Bad Request: PHOTO_URL_INVALID")
    ) {
      console.error("Error in sendQuestion:", err);
    }
  }
}

async function handleAnswer(callbackQuery, chatId, data) {
  const isMember = await membership.verify(bot, chatId);
  if (!isMember) return sendSubscriptionPrompt(chatId);

  const state = userStates[chatId];
  if (!state || isNaN(data)) return;

  const selected = parseInt(data);
  const question = state.questions?.[state.current];
  const correctIndex = question?.ans;

  if (state.answers[state.current] !== null) {
    // If already answered, don't allow re-answering
    return bot.answerCallbackQuery(callbackQuery.id, {
      text: "Դուք արդեն պատասխանել եք այս հարցին։",
      show_alert: false,
    });
  }

  // Show a temporary "processing" state or disable buttons while processing
  const tempKeyboard = question.opts.map((opt) => [
    { text: opt, callback_data: "ignore_answer_in_progress" },
  ]);
  await bot
    .editMessageReplyMarkup(
      { inline_keyboard: tempKeyboard },
      { chat_id: chatId, message_id: state.lastMessageId },
    )
    .catch((err) => {
      if (!err.message.includes("message is not modified")) {
        console.error("Error updating temp keyboard:", err);
      }
    });

  state.answers[state.current] = selected;
  state.manualNav = false;

  if (selected === correctIndex) {
    state.score++;
    await bot.answerCallbackQuery(callbackQuery.id, { text: "✅ Ճիշտ է։" });
  } else {
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: `❌ Սխալ։ Ճիշտ պատասխանը՝ ${question?.opts[correctIndex]}`,
    });
  }

  // Update the keyboard to show feedback (correct/incorrect)
  const feedbackKeyboard = question?.opts.map((opt, i) => {
    const prefix = i === correctIndex ? "✅ " : i === selected ? "❌ " : "";
    return [{ text: `${prefix}${opt}`, callback_data: "ignore" }];
  });

  const nextButtons = [];
  if (state.current > 0)
    nextButtons.push({ text: "⬅️ Նախորդը", callback_data: "go_back" });
  if (state.current < state.total - 1) {
    nextButtons.push({
      text: "Հաջորդը ➡️",
      callback_data: "next_question",
    });
  } else {
    nextButtons.push({ text: "🏁 Ավարտել", callback_data: "next_question" });
  }
  if (nextButtons.length) feedbackKeyboard.push(nextButtons);

  await bot
    .editMessageReplyMarkup(
      { inline_keyboard: feedbackKeyboard },
      { chat_id: chatId, message_id: state.lastMessageId },
    )
    .catch((err) => {
      if (
        !err.message.includes("message is not modified") &&
        !err.message.includes("canceled by new editMessageMedia request")
      ) {
        console.error("editMessageReplyMarkup error:", err);
      }
    });
}

function showFinalResult(chatId, score, total) {
  const state = userStates[chatId];
  const level =
    QUIZ_TITLES.find((lvl) => score >= lvl.min && score <= lvl.max)?.title ||
    "📘 Սկսնակ";
  const category = state?.category;

  if (category) {
    userResults[chatId] = userResults[chatId] || {};
    userResults[chatId][category] = { score, total };
  }

  clearQuestionOnly(chatId); // Clear the last question message before showing the result

  bot
    .sendMessage(
      chatId,
      `${categoryNames[state.category]} 🏁 Վիկտորինան ավարտվեց։\n\n📊 Արդյունք՝ ${score}/${total} ճիշտ պատասխան\n📌`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🎯 Ընտրել կատեգորիա",
                callback_data: "show_categories",
              },
            ],
          ],
        },
      },
    )
    .then((msg) => {
      // Store the message ID of the final result message
      finalResultMessages[chatId] = msg.message_id;
    });

  delete userStates[chatId]; // Clear the user's current quiz state
}

function shuffleArray(array) {
  return array
    .map((value) => ({ value, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ value }) => value);
}
