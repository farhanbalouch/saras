"""Text-only speech sanitization; display text may retain emoji."""
import re
EMOJI=re.compile('[\U0001F000-\U0001FAFF\u2600-\u27BF\uFE0E\uFE0F\u20E3\U000E0020-\U000E007F]')
def without_emoji(text):
 text=EMOJI.sub('',text)
 text=re.sub(r'(?<!\w)\u200d|\u200d(?!\w)','',text)
 return re.sub(r'[ \t]{2,}',' ',text).strip()
