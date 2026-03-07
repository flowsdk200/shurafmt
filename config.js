import fs from 'fs'

const config = {
    botName: 'shurafmt',
    botVersion: '1.0.0',
    ownerNumbers: ['6285226344606'],
    prefixes: ['!', '.', '/'],
    sessionName: 'session',
    thumb: fs.readFileSync('./assets/thumb.jpg'),
    numPrefix: '62',
    logChats: false,
    autoRead: true,
    selfMode: false,
    onlyGroup: false,
    onlyPrivate: false,
    onlyOwner: false,
    onlyPremium: false,
    mongoUri: 'mongodb+srv://shurafmt:shurafmtwa@shurafmt.nctmax.mongodb.net/shurafmt?appName=shurafmt',
    redisUrl: 'redis://default:msCsKa5PlgrfhmzQeXpz18Tk8eSHLOD8@redis-16718.c44.us-east-1-2.ec2.cloud.redislabs.com:16718',
    r2: {
        endpoint: 'https://db98bdb7df43af92900b66532329d8ff.r2.cloudflarestorage.com',
        accessKeyId: '126cb5003d5c6d3b096f7ff7c4676c65',
        secretAccessKey: 'cd84f5b48b7907a42e6caf471904ca2c24e37a7b1f17e3c75bb6feaaed7ebec7',
        bucket: 'shura',
        publicBaseUrl: 'https://9z9.web.id',
        prefix: '',
        idLength: 6
    },
    weatherApiKey: '0978f91adc6244088a9181544260603',
    channelJid: '120363387535716103@newsletter',
    channelLink: 'https://whatsapp.com/channel/0029Vb8IWc3FSAsy4xaX991n',
    scriptUrl: 'https://github.com/yemo-dev/biohazard-botz',
    limits: {
        owner: 2000,
        premium: 1000,
        free: 50
    },
    groupDefaults: {
        welcome: true,
        goodbye: true,
        antiluar: false
    }
}

export default config
