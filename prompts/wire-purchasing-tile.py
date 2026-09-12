import pathlib
p = pathlib.Path("wardsynq/site/shell.js")
s = p.read_text()
old = '      tile({ go: "ward:approvals", icon: "verified", title: "Approvals", sub: "Ask for an approval for a restricted medicine, and grant the ones waiting", need: ["emr.vitals", "emr.treat"] }),'
new = old + '''
      /* Purchasing sits behind the pharmacy's own capability, not a clinical one: ordering stock is
       * the storekeeper's job and has never been the ward's. */
      tile({ go: "ward:purchasing", icon: "inventory", title: "Purchasing", sub: "Raise a supplier order, get it approved, and book the stock in when it arrives", need: "order.dispense" }),'''
assert s.count(old) == 1
s = s.replace(old, new)
p.write_text(s)
print("tile added")
