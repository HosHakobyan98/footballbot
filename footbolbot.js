require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const Membership = require('./membership');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });
const membership = new Membership(process.env.SPONSORS);

const allQuestions=require('./questions')

const userStates = {};


bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "⚽ Բարի գալուստ Ֆուտբոլային Վիկտորինա։\n\nՍեղմիր ներքևի կոճակը սկսելու համար։", {
        reply_markup: {
            inline_keyboard: [
                [{ text: "✅ Սկսել Վիկտորինան", callback_data: "start_quiz" }],
            ],
        },
    });
});

bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;

    if (data === 'start_quiz') {
        const isSubscribed = await membership.verify(bot, chatId);
        if (!isSubscribed) {
            const links = membership.getSponsorsList().map(link => `🔗 https://t.me/${link}`).join('\n');
            return bot.sendMessage(
                chatId,
                `❗ Խնդրում ենք բաժանորդագրվել հովանավոր ալիքներին․\n\n${links}\n\n📲 Բաժանորդագրվելուց հետո սեղմիր «🔄 Ստուգել բաժանորդագրումը» կոճակը։`,
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🔄 Ստուգել բաժանորդագրումը", callback_data: 'check_subscription' }],
                        ],
                    }
                }
            );
        }
        startQuiz(chatId);
        return;
    }
    if (data === 'check_subscription') {
        const isSubscribed = await membership.verify(bot, chatId);
        if (!isSubscribed) {
            return bot.answerCallbackQuery(callbackQuery.id, {
                text: "❌ Դեռ բաժանորդագրված չես։",
                show_alert: true
            });
        }
        startQuiz(chatId);
        return;
    }
    if (data === 'try_again') {
        startQuiz(chatId);
        return;
    }

    if (!userStates[chatId]) return;
    const state = userStates[chatId];

    if (data === 'continue') {
        state.finished = false;
        sendNextQuestion(chatId);
        return;
    }

    if (data === 'stop') {
        bot.sendMessage(chatId, '🏁 Շնորհակալություն վիկտորինայի համար։');
        delete userStates[chatId];
        return;
    }

    if (state.finished) return;

    const selected = parseInt(data);
    const question = allQuestions[state.current];
    const correctIndex = question.ans;

    const newKeyboard = question.opts.map((opt, i) => {
        let prefix = '';
        if (i === correctIndex) prefix = '✅ ';
        else if (i === selected) prefix = '❌ ';
        return [{ text: `${prefix}${opt}`, callback_data: 'ignore' }];
    });

    await bot.editMessageReplyMarkup(
        { inline_keyboard: newKeyboard },
        { chat_id: chatId, message_id: callbackQuery.message.message_id }
    );

    if (selected === correctIndex) {
        state.score++;
        await bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Ճիշտ է!' });
    } else {
        await bot.answerCallbackQuery(callbackQuery.id, {
            text: `❌ Սխալ։ Ճիշտ պատասխանը՝ ${question.opts[correctIndex]}`,
        });
    }

    state.current++;

    if (state.current >= allQuestions.length) {
        const score = state.score;
        const total = state.current;

        let title = '📘 Սկսնակ';

        if (score >= 5 && score <= 9) {
            title = '📗Ցածր մակարդակ ';
        } else if (score >= 10 && score <= 14) {
            title = '📙Հետաքրքրված ֆուտբոլասրեր ';
        } else if (score >= 15 && score <= 19) {
            title = '📕 Միջին մակարդակ';
        } else if (score >= 20 && score <= 24) {
            title = '🎯 Անչափ տեղեկացված';
        } else if (score >= 25 && score < total) {
            title = '🥇 Գիտակ';
        } else if (score === total) {
            title = '🏆 Վարպետ';
        }

        bot.sendMessage(
            chatId,
            `🏁 Վիկտորինան ավարտվեց։\n\n📊 Արդյունք՝ ${score}/${total} ճիշտ պատասխան\n📌 Կարգավիճակդ՝ ${title}\n\n📚 Մեր հարցերը պարբերաբար թարմացվում են։`,
            {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🔁 Խաղալ կրկին", callback_data: 'try_again' }]
                    ]
                }
            }
        );
        delete userStates[chatId];
        return;
    } else {
        setTimeout(() => sendNextQuestion(chatId), 2000);
    }
});

function startQuiz(chatId) {
    userStates[chatId] = {
        score: 0,
        current: 0,
        finished: false,
    };
    // bot.sendMessage(chatId, "📢 Սկսում ենք վիկտորինան։ Պատրաստ եղիր։");
    sendNextQuestion(chatId);
}

function sendNextQuestion(chatId) {
    const state = userStates[chatId];
    const question = allQuestions[state.current];

    if (!question) {
        bot.sendMessage(chatId, '✅ Մեր հարցերը ժամանակավորապես ավարտվել են։ Շուտով ավելացվելու են։');
        delete userStates[chatId];
        return;
    }
    const opts = {
        reply_markup: {
            inline_keyboard: question.opts.map((opt, i) => [
                { text: opt, callback_data: i.toString() }
            ])
        }
    };
    bot.sendMessage(chatId, `❓ Հարց ${state.current + 1}․\n${question.q}`, opts);
}
