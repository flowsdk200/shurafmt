import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'rfi',
    aliases: ['rfinews'],
    description: 'RFI News',
    feed: 'https://www.rfi.fr/en/rss',
})
