import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'techcrunch',
    aliases: ['tcnews'],
    description: 'TechCrunch',
    feed: 'https://techcrunch.com/feed/',
})
