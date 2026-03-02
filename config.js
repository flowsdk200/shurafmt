import fs from 'fs'

const getThumbBuffer = () => {
    try {
        return fs.readFileSync(new URL('./assets/thumb.jpg', import.meta.url))
    } catch {
        return Buffer.alloc(0)
    }
}

const config = {
    botName: 'shurafmt',
    botVersion: '1.0.0',
    ownerNumbers: ['6285226344606', '6282136015864'],
    prefixes: ['!', '.', '/'],
    sessionName: 'session',
    thumb: getThumbBuffer(),
    logChats: false,
    autoRead: true,
    selfMode: false,
    mongoUri: 'mongodb+srv://shurafmt:shurafmtwa@shurafmt.nctmax.mongodb.net/shurafmt?appName=shurafmt',
    channelJid: '120363387535716103@newsletter',
    businessJid: '6285226344606@s.whatsapp.net',
    scriptUrl: 'https://github.com/yemo-dev/biohazard-botz',
    limits: {
        owner: 2000,
        premium: 1000,
        free: 50
    }
}

export default config
