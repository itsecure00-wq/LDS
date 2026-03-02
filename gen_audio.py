import asyncio
import edge_tts
import os

NARRATIONS = [
    '哇！张崇会火锅！超级抽奖活动，现在开始！大奖等着你，来拿！',
    '第一步！扫码注册，马上送你积分！就这么简单，注册就能抽！',
    '想要更多机会？把邀请码分享给朋友！朋友注册，你直接拿积分！越多朋友，越多机会！',
    '每次来吃火锅，记得打卡！打一次卡，多一次抽奖机会，吃饭还能赢大奖！',
    '用积分抽奖，一分一次！每天最多三次，天天都有机会赢！',
    '奖品超丰富！免费饮料、甜品、双人套餐！还有神秘大奖等你来拿！',
    '记住！积分九十天有效，别忘了用！中奖后三十天内来店核销，就搞定了！',
    '还等什么！现在扫码，注册，马上抽！说不定，大奖就是你的！来！',
]

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

async def gen(idx, text):
    fname = os.path.join(OUT_DIR, f'audio_{idx+1}.mp3')
    communicate = edge_tts.Communicate(
        text,
        voice='zh-CN-YunxiNeural',    # 云希 — 活力男声，像游戏主持人
        rate='+8%',    # 比正常快一点点，有活力但不赶
        pitch='+12Hz', # 高一点，明亮有朝气
        volume='+15%',
    )
    await communicate.save(fname)
    print(f'  [ok] audio_{idx+1}.mp3 done ({len(text)} chars)')

async def main():
    print('Generating audio files...')
    tasks = [gen(i, text) for i, text in enumerate(NARRATIONS)]
    await asyncio.gather(*tasks)
    print(f'\nDone! {len(NARRATIONS)} MP3 files generated.')

asyncio.run(main())
