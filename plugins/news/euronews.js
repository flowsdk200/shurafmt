import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'euronews',
    aliases: ['euro'],
    description: 'Euronews',
    feed: 'https://www.euronews.com/rss?level=world',
})
