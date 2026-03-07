import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'foxnews',
    aliases: ['fox'],
    description: 'Fox News',
    feed: 'https://moxie.foxnews.com/google-publisher/world.xml',
})
