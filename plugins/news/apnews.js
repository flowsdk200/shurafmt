import { createManualNewsCommand } from './_manualnews.js'

export default createManualNewsCommand({
    name: 'apnews',
    aliases: ['apn'],
    description: 'AP News',
    sourceUrl: 'https://apnews.com/world-news',
    linkPattern: /^https?:\/\/(?:www\.)?apnews\.com\/article\/[a-z0-9-]+/i,
    maxCandidates: 80,
    selector: 'a[href]'
})
