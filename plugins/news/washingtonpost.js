import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'washpost',
    aliases: ['washingtonpost'],
    description: 'Washington Post',
    feed: 'https://feeds.washingtonpost.com/rss/world',
})
