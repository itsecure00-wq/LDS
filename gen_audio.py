import asyncio
import edge_tts
import os

NARRATIONS = [
    '哇！张崇会火锅！超级抽奖活动，现在开始！大奖等着你，来拿！',
    '第一步！扫码注册，马上送你积分！就这么简单，注册就能抽！',
    '想要更多机会？把邀请码分享给朋友！朋友注册，你直接拿积分！越多朋友，越多机会！',
    '每次来吃火锅，记得打卡！打一次卡，多一次抽奖机会，吃饭还能赢大奖！',
    '用积分抽奖，一分一次！每天最多三次，天天都有机会赢！',
    '奖品超丰富！饮品、甜品、代金券！还有200元霸王卷大奖等你来拿！',
    '记住！积分九十天有效，别忘了用！中奖后三十天内来店核销，就搞定了！',
    '还等什么！现在扫码，注册，马上抽！说不定，大奖就是你的！来！',
]

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

async def gen(idx, text):
    fname = os.path.join(OUT_DIR, f'audio_{idx+1}.mp3')
    communicate = edge_tts.Communicate(
        text,
        voice='zh-CN-YunjianNeural',   # 云健 — 浑厚有力，传销感满满
        rate='+12%',   # 快一些，有紧迫感
        pitch='+8Hz',  # 稍高，更有穿透力
        volume='+20%',
    )
    await communicate.save(fname)
    print(f'  [ok] audio_{idx+1}.mp3 done ({len(text)} chars)')

async def main():
    print('Generating audio files...')
    tasks = [gen(i, text) for i, text in enumerate(NARRATIONS)]
    await asyncio.gather(*tasks)
    print(f'\nDone! {len(NARRATIONS)} MP3 files generated.')

asyncio.run(main())
