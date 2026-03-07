import { createManualNewsCommand } from './_manualnews.js'

export default createManualNewsCommand({
    name: 'tribun',
    aliases: ['tribunnews'],
    description: 'Tribun News',
    feed: 'https://www.tribunnews.com/rss',
    useRss: true,
    linkPattern: /^https?:\/\/(?:[a-z0-9.-]+\.)?tribunnews\.com\/.+/i,
    maxCandidates: 50
})

