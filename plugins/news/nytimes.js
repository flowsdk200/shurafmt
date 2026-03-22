import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'nytimes',
    aliases: ['ny'],
    description: 'New York Times',
    feed: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',
})
