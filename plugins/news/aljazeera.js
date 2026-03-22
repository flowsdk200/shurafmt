import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'aljazeera',
    aliases: ['aj'],
    description: 'Al Jazeera',
    feed: 'https://www.aljazeera.com/xml/rss/all.xml',
})
