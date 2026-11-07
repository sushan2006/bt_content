# Worked example: "How an electric water motor works" (approved by the team, 3D Explainer style)

> This example shows the level of quality and the kind of reasoning that was approved. It is not a template: every video gets its own ideas, its own wow moment and its own objects. Do not copy its beats onto a different topic.

Transcript (word ids; times are seconds in the edited video):
```
[  0.07-  3.92] w0:Hi w1:everyone, w2:I'm w3:from w4:Beastings w5:and w6:I w7:work w8:there w9:as w10:an w11:IoT w12:engineer.
[  4.13-  7.77] w13:Today w14:I w15:will w16:talk w17:about w18:a w19:device w20:most w21:of w22:us w23:use w24:daily w25:without w26:a w27:second w28:thought.
[  7.98-  8.98] w29:electric w30:water w31:motor.
[  9.19- 19.32] w32:The w33:electric w34:water w35:motor w36:converts w37:the w38:electrical w39:energy w40:into w41:the w42:mechanical w43:energy w44:to w45:move w46:the w47:water w48:from w49:the w50:low w51:elevated w52:regions w53:to w54:the w55:high w56:elevated w57:regions w58:like w59:from w60:the w61:borewell w62:sorms w63:to w64:the w65:tanks.
[ 19.53- 22.83] w66:So w67:the w68:electric w69:water w70:motor w71:majorly w72:consists w73:of w74:two w75:parts.
[ 23.04- 24.42] w76:The w77:motor w78:is w79:a w80:driver.
[ 24.63- 27.29] w81:has w82:a w83:starter w84:with w85:a w86:copper w87:winding w88:and w89:a w90:stile w91:rotor.
[ 27.50- 31.40] w92:When w93:the w94:current w95:flows, w96:it w97:creates w98:a w99:magnetic w100:field w101:that w102:spins w103:the w104:rotor.
[ 31.61- 33.09] w105:The w106:pump w107:is w108:a w109:delivery w110:system
[ 33.30- 35.21] w111:attached w112:to w113:the w114:motor w115:shaft w116:inside w117:it.
[ 35.42- 36.92] w118:It w119:is w120:a w121:spinning w122:employer.
[ 37.13- 39.59] w123:Those w124:water w125:outwards w126:by w127:the w128:centrifugal w129:force,
[ 39.80- 45.28] w130:this w131:creates w132:a w133:suction w134:that w135:draws w136:the w137:water w138:in w139:through w140:the w141:suction w142:pipe w143:and w144:pushes w145:it w146:out w147:through
[ 45.49- 46.55] w148:the w149:delivery w150:pipe.
[ 46.76- 47.70] w151:So w152:the w153:electric w154:motor
[ 47.91- 51.93] w155:has w156:a w157:0.5 w158:to w159:1.5 w160:horsepower
[ 52.14- 55.43] w161:and w162:it w163:can w164:pull w165:up w166:to w167:20 w168:meters w169:of w170:hydrogen w171:in w172:the w173:water.
```
The direction that produced the approved edit:
```json
{
  "style": "editorial",
  "corrections": {"Beastings": "BridgeThings", "sorms": "sumps", "starter": "stator", "stile": "steel", "employer": "impeller", "Those": "Throws", "hydrogen": "head"},
  "drop_words": [0, 1],
  "emphasis": ["BridgeThings", "converts", "stator", "rotor", "magnetic", "impeller", "centrifugal", "suction", "horsepower", "20"],
  "headline": "How a water motor really works",
  "beats": [
    {"kind": "object", "asset": "builtin:brand", "start_word": 2, "end_word": 12, "enter": "still", "stage_params": {"role": "IoT engineer"},
     "reason": "he introduces himself: the logo assembles while he says the company name"},
    {"kind": "text_behind", "start_word": 29, "end_word": 31, "lines": ["WATER", "MOTOR"], "reason": "the topic, huge, behind him on the hook"},
    {"kind": "explainer", "asset": "builtin:energy", "start_word": 32, "end_word": 43, "stage_params": {"strike_at": 1.9, "mech_at": 2.9},
     "reason": "cuts away on 'converts': the bolt hits the motor on 'electrical energy', the shaft turns on 'mechanical energy'"},
    {"kind": "explainer", "asset": "builtin:lift", "start_word": 48, "end_word": 65, "reason": "water travels from the sump to the tank while he says it"},
    {"kind": "object", "asset": "builtin:pump_set", "start_word": 71, "end_word": 80, "enter": "rise", "side": "right",
     "stage_params": {"explode_at": 0.9, "label_times": {"pump": 1.2, "motor": 2.3}}, "reason": "back on him for 'two parts': the set rises and separates into motor and pump"},
    {"kind": "explainer", "asset": "builtin:motor_inside", "start_word": 81, "end_word": 104,
     "stage_params": {"energize_at": 3.5, "label_times": {"stator": 0.7, "rotor": 2.5, "field": 4.7}}, "reason": "inside the motor: stator, rotor, and the field when the current flows"},
    {"kind": "object", "asset": "builtin:pump_set", "start_word": 105, "end_word": 117, "enter": "rise", "side": "left",
     "stage_params": {"highlight": "pump", "label_times": {"pump": 0.95}, "pump_sub": "on the motor shaft"}, "reason": "the pump is highlighted on the set while he places it"},
    {"kind": "explainer", "asset": "builtin:pump_inside", "start_word": 118, "end_word": 129,
     "stage_params": {"label_times": {"impeller": 1.1, "water": 1.8, "centrifugal": 3.5}}, "reason": "the cover comes off on 'spinning impeller'"},
    {"kind": "explainer", "asset": "builtin:pump_flow", "start_word": 133, "end_word": 150,
     "stage_params": {"label_times": {"suction": 0.4, "delivery": 3.2}}, "reason": "water drawn in through suction and pushed out through delivery"},
    {"kind": "number", "value": 0.5, "value_to": 1.5, "label": "horsepower", "start_word": 155, "end_word": 160, "reason": "the spoken rating, in 3D next to him"},
    {"kind": "explainer", "asset": "builtin:head", "start_word": 161, "end_word": 173, "reason": "the camera rises with the water 20 m to the tank as he says it"}
  ],
  "notes": ["Alternates between the speaker and five full-screen explainers that follow the explanation word by word.",
            "Spelling of misheard technical words corrected in the captions; please check 'head' (pump head) is right."],
  "metadata": {"title": "How a water motor works", "caption": "From the sump to your tank: what really happens inside an electric water motor.", "hashtags": ["#engineering", "#watermotor", "#howitworks"]}
}
```
Why it works: one idea per beat, each beat starts on the word it illustrates, the speaker is seen between explainers, objects rise from behind him when he names them, technical words are corrected, and the numbers on screen are the ones he says.

For a topic that has no builtin asset (a transformer, a solar inverter, a smart meter, a conveyor, a sensor) you build the objects with the kit and animate them with actions in the same way.
