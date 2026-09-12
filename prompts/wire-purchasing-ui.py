import pathlib
p = pathlib.Path("ward.js")
s = p.read_text()

old = '    if (cmd === "approvals") { approvalsOpen(); return; }'
new = old + '''
    if (cmd === "purchasing") { purchasingOpen(); return; }
    if (cmd === "poraise") { poRaise(); return; }
    if (cmd === "poask") { poAskApproval(arg); return; }
    if (cmd === "poreceive") { poReceive(arg); return; }'''
assert s.count(old) == 1, "dispatch"
s = s.replace(old, new)

old = '        : state.view === "approvals" ? approvalsView(state)'
new = '        : state.view === "purchasing" ? purchasingView(state)\n' + old
assert s.count(old) == 1, "render"
s = s.replace(old, new)

old = '      if (st.view === "approvals") { st.approvals = null; st.view = "list"; paint(); return; }'
new = '      if (st.view === "purchasing") { st.purchaseOrders = null; st.view = "list"; paint(); return; }\n' + old
assert s.count(old) == 1, "back"
s = s.replace(old, new)

old = '    st.approvals = null;'
new = old + '\n    st.purchaseOrders = null;'
assert s.count(old) == 1, "close"
s = s.replace(old, new)

old = '"incidents", "approvals"]'
new = '"incidents", "approvals", "purchasing"]'
assert s.count(old) == 1, "acts"
s = s.replace(old, new)

p.write_text(s)
print("ui wired")
