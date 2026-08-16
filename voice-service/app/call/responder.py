"""Short-voice formatter: turns a conversation event into ONE short spoken line (spec §7).

The FollowCare engine and questions can be verbose; the phone agent must be brief and natural. These are
fixed, reviewed lines (not model-generated) so the spoken script is predictable and safe. English is complete;
hi/te cover the key lines and fall back to English otherwise (mirrors followcare-i18n's `reviewed` model —
adding fully-reviewed translations for all 12 languages is a follow-up, same as the digital side).
"""

_LINES = {
    "en": {
        "greeting": "Hello, this is the automated follow-up assistant from your hospital. Am I speaking with {name}?",
        "greeting_generic": "Hello, this is the automated follow-up assistant from your hospital. Am I speaking with the patient?",
        "greeting_guardian": "Hello, this is the automated follow-up assistant from your hospital. Am I speaking with the patient's guardian?",
        "reask_verify": "Sorry, could you please confirm — am I speaking with {name}?",
        "wrong_person": "Sorry to disturb you. Goodbye.",
        "unclear": "Sorry, I didn't quite catch that.",
        "ack": "Thank you.",
        "notify_doctor": "I'm sorry you're feeling worse. I'll notify your doctor.",
        "ambulance_offer": "That may need urgent attention. Would you like an ambulance?",
        "ambulance_yes": "Okay. I'll notify the hospital ambulance team now.",
        "ambulance_no": "Okay. Please contact your doctor if it gets worse. Take care.",
        "close_good": "That's good to hear. Please continue your recovery, and we'll keep monitoring you.",
        "close_ok": "Thank you. Please continue as advised, and we'll keep monitoring you. Goodbye.",
    },
    "hi": {
        "greeting": "नमस्ते, मैं आपके अस्पताल की स्वचालित फ़ॉलो-अप सहायक हूँ। क्या मेरी बात {name} से हो रही है?",
        "greeting_generic": "नमस्ते, मैं आपके अस्पताल की स्वचालित फ़ॉलो-अप सहायक हूँ। क्या मेरी बात मरीज़ से हो रही है?",
        "notify_doctor": "मुझे खेद है कि आप ठीक महसूस नहीं कर रहे। मैं आपके डॉक्टर को सूचित करती हूँ।",
        "ambulance_offer": "इसमें तुरंत ध्यान देने की ज़रूरत हो सकती है। क्या आप एम्बुलेंस चाहेंगे?",
        "ambulance_yes": "ठीक है। मैं अभी अस्पताल की एम्बुलेंस टीम को सूचित करती हूँ।",
        "close_good": "यह सुनकर अच्छा लगा। कृपया अपना ध्यान रखें, हम निगरानी करते रहेंगे।",
    },
    "te": {
        "greeting": "నమస్తే, నేను మీ ఆసుపత్రి నుండి ఆటోమేటెడ్ ఫాలో-అప్ అసిస్టెంట్‌ని. నేను {name} గారితో మాట్లాడుతున్నానా?",
        "greeting_generic": "నమస్తే, నేను మీ ఆసుపత్రి నుండి ఆటోమేటెడ్ ఫాలో-అప్ అసిస్టెంట్‌ని. నేను రోగితో మాట్లాడుతున్నానా?",
        "greeting_guardian": "నమస్తే, నేను మీ ఆసుపత్రి నుండి ఆటోమేటెడ్ ఫాలో-అప్ అసిస్టెంట్‌ని. నేను రోగి సంరక్షకుడితో మాట్లాడుతున్నానా?",
        "reask_verify": "క్షమించండి, దయచేసి నిర్ధారించండి — నేను {name} గారితో మాట్లాడుతున్నానా?",
        "wrong_person": "మిమ్మల్ని ఇబ్బంది పెట్టినందుకు క్షమించండి. వీడ్కోలు.",
        "unclear": "క్షమించండి, నాకు అది సరిగ్గా వినిపించలేదు.",
        "ack": "ధన్యవాదాలు.",
        "notify_doctor": "మీరు బాగోలేదని విన్నందుకు చింతిస్తున్నాను. నేను మీ డాక్టర్‌కు తెలియజేస్తాను.",
        "ambulance_offer": "దీనికి తక్షణ శ్రద్ధ అవసరం కావచ్చు. మీకు అంబులెన్స్ కావాలా?",
        "ambulance_yes": "సరే. నేను ఇప్పుడే ఆసుపత్రి అంబులెన్స్ బృందానికి తెలియజేస్తాను.",
        "ambulance_no": "సరే. పరిస్థితి మరింత దిగజారితే దయచేసి మీ డాక్టర్‌ను సంప్రదించండి. జాగ్రత్తగా ఉండండి.",
        "close_good": "అది వినడం సంతోషం. దయచేసి కోలుకోవడం కొనసాగించండి, మేము పర్యవేక్షిస్తూ ఉంటాము.",
        "close_ok": "ధన్యవాదాలు. దయచేసి సూచించిన విధంగా కొనసాగించండి, మేము పర్యవేక్షిస్తూ ఉంటాము. వీడ్కోలు.",
    },
}


def say(line, lang="en", **vars):
    table = _LINES.get(lang or "en", _LINES["en"])
    tpl = table.get(line) or _LINES["en"].get(line) or ""
    try:
        return tpl.format(**vars)
    except (KeyError, IndexError):
        return tpl
