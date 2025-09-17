import frappe

def _default_company():
    return frappe.db.get_single_value("Global Defaults", "default_company")

def _ensure_customer(name="Walk-in Customer"):
    if frappe.db.exists("Customer", name):
        return name
    # تأكد من جروبات/تيريتوري الافتراضية
    cg = frappe.db.exists("Customer Group", "All Customer Groups") or "All Customer Groups"
    tr = frappe.db.exists("Territory", "All Territories") or "All Territories"
    doc = frappe.get_doc({
        "doctype": "Customer",
        "customer_name": name,
        "customer_group": cg,
        "territory": tr
    })
    doc.insert(ignore_permissions=True)
    return doc.name

def _ensure_si_table_cf():
    """Custom Field على Sales Invoice لربط الترابيزة."""
    if not frappe.db.exists("Custom Field", "Sales Invoice-restaurant_table"):
        from frappe.custom.doctype.custom_field.custom_field import create_custom_field
        create_custom_field("Sales Invoice", {
            "fieldname": "restaurant_table",
            "label": "Restaurant Table",
            "fieldtype": "Link",
            "options": "Restaurant Table",
            "insert_after": "customer",
            "reqd": 0
        })
        frappe.clear_cache(doctype="Sales Invoice")

@frappe.whitelist()
def list_tables(restaurant=None):
    filters = {}
    if restaurant:
        filters["restaurant"] = restaurant
    # نجلب حقول عامة مع مرونة في أسماء الرقم/الاسم
    rows = frappe.get_all("Restaurant Table",
                          filters=filters,
                          fields=["name", "restaurant", "status",
                                  "table_number", "table_no", "table_name", "capacity"])
    out = []
    for r in rows:
        label = r.get("table_number") or r.get("table_no") or r.get("table_name") or r["name"]
        out.append({
            "name": r["name"],
            "label": label,
            "status": r.get("status") or "Free",
            "capacity": r.get("capacity"),
            "restaurant": r.get("restaurant")
        })
    return out

@frappe.whitelist()
def get_active_menu(restaurant=None):
    """نختار أول Restaurant Menu مرتبط (بسيطة)، Price List = اسم المينيو (زي ما ضبطناه بالسكربت)."""
    f = {}
    if restaurant:
        f["restaurant"] = restaurant
    menus = frappe.get_all("Restaurant Menu", filters=f, fields=["name", "restaurant"], limit=1, order_by="modified desc")
    if not menus:
        return {}
    menu = menus[0]
    return {"menu": menu["name"], "price_list": menu["name"]}

@frappe.whitelist()
def list_menu_items(menu=None, price_list=None, search=None, limit=200):
    if not price_list and menu:
        price_list = menu
    if not price_list:
        return []
    args = {"pl": price_list, "lim": int(limit)}
    cond = ""
    if search:
        args["s1"] = f"%{search}%"
        args["s2"] = f"%{search}%"
        cond = "and (ip.item_code like %(s1)s or i.item_name like %(s2)s)"
    return frappe.db.sql(f"""
        select ip.item_code, i.item_name, ip.price_list_rate as rate
        from `tabItem Price` ip
        left join `tabItem` i on i.name = ip.item_code
        where ip.price_list = %(pl)s {cond}
        order by i.item_name
        limit %(lim)s
    """, args, as_dict=True)

@frappe.whitelist()
def open_or_get_order(restaurant, table, company=None, customer=None):
    _ensure_si_table_cf()
    company = company or _default_company()
    customer = customer or _ensure_customer()

    # لو فيه فاتورة Draft مفتوحة لنفس الترابيزة رجّعها
    name = frappe.db.get_value("Sales Invoice", {"docstatus": 0, "restaurant_table": table}, "name")
    if name:
        si = frappe.get_doc("Sales Invoice", name)
        return {"invoice": si.as_dict()}

    # حدّد المينيو/قائمة الأسعار
    info = get_active_menu(restaurant)
    price_list = info.get("price_list") if info else None

    # أنشئ فاتورة جديدة Draft
    si = frappe.new_doc("Sales Invoice")
    si.company = company
    si.customer = customer
    si.restaurant_table = table
    si.is_pos = 1
    if price_list:
        si.selling_price_list = price_list
    si.set_posting_time = 1
    si.due_date = frappe.utils.nowdate()
    si.insert(ignore_permissions=True)
    return {"invoice": si.as_dict()}

@frappe.whitelist()
def add_item(invoice=None, restaurant=None, table=None, item_code=None, qty=1):
    """لو invoice مش متبعتة، نفتحه/ننشئه من الترابيزة."""
    if not invoice:
        if not (restaurant and table):
            frappe.throw("Missing invoice or (restaurant+table)")
        invoice = open_or_get_order(restaurant, table)["invoice"]["name"]
    si = frappe.get_doc("Sales Invoice", invoice)
    row = si.append("items", {"item_code": item_code, "qty": float(qty)})
    si.flags.ignore_permissions = True
    si.calculate_taxes_and_totals()
    si.save()
    return {"invoice": si.as_dict()}

@frappe.whitelist()
def set_row_qty(invoice, row_idx, qty):
    """row_idx مبني على ترتيب العناصر كما في الواجهة."""
    si = frappe.get_doc("Sales Invoice", invoice)
    idx = int(row_idx)
    if idx < 0 or idx >= len(si.items):
        frappe.throw("Invalid row index")
    if float(qty) <= 0:
        # حذف الصف
        si.items.pop(idx)
    else:
        si.items[idx].qty = float(qty)
    si.flags.ignore_permissions = True
    si.calculate_taxes_and_totals()
    si.save()
    return {"invoice": si.as_dict()}

@frappe.whitelist()
def get_invoice(invoice):
    si = frappe.get_doc("Sales Invoice", invoice)
    return {"invoice": si.as_dict()}

@frappe.whitelist()
def save_invoice(invoice):
    si = frappe.get_doc("Sales Invoice", invoice)
    si.flags.ignore_permissions = True
    si.save()
    return {"invoice": si.as_dict()}

@frappe.whitelist()
def submit_invoice(invoice):
    si = frappe.get_doc("Sales Invoice", invoice)
    si.flags.ignore_permissions = True
    si.submit()
    return {"invoice": si.as_dict()}

@frappe.whitelist()
def cancel_invoice(invoice):
    si = frappe.get_doc("Sales Invoice", invoice)
    si.flags.ignore_permissions = True
    si.cancel()
    return {"invoice": si.as_dict()}
