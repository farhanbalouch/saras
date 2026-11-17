(function(){
'use strict';
function route(text,mode='auto'){
 if(mode!=='auto')return mode;
 if(/^(how|why|explain|teach|what does|kaise|kyun|samjhao|کیا مطلب|سمجھاؤ)\b/i.test(text))return 'chat';
 if(/^(remember\s*:|yaad rakho\s*:|memory\s*:|یاد رکھو\s*:)/i.test(text)||/^(voice (on|off)|dark mode|light mode|settings|my settings|meri settings|language\s*:)/i.test(text))return 'settings';
 if(/^(?:saras[,،]?\s*)?(?:open|close|launch|shutdown|restart|scroll|click|type|press|search (?:youtube|files)|wifi|wi-fi|bluetooth|volume|brightness|screenshot|clipboard|stop scrolling|cancel shutdown|current time|notepad|calculator)\b/i.test(text)||/(?:mere|mera|mery|my)\s+(?:pc|laptop|computer)\b.*(?:karo|kholo|band|open|close|chalao)/i.test(text))return 'pc';
 return 'chat';
}
globalThis.SarasAssistantRouting={route};
})();
