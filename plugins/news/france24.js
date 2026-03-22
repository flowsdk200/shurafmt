import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'france24',
    aliases: ['france'],
    description: 'France 24',
    feed: 'https://www.france24.com/en/rss',
})
