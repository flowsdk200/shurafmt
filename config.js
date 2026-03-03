import fs from 'fs'

const config = {
    botName: 'shurafmt',
    botVersion: '1.0.0',
    ownerNumbers: ['6285226344606', '6282136015864'],
    prefixes: ['!', '.', '/'],
    sessionName: 'session',
    thumb: fs.readFileSync('./assets/thumb.jpg'),
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
    },
    groupDefaults: {
        welcome: true,
        goodbye: true
    }
}

export default config
