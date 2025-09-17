frappe.pages['restaurant-order-entry'].on_page_load = function(wrapper) {
  const page = frappe.ui.make_app_page({
    parent: wrapper,
    title: 'Restaurant Order Entry',
    single_column: true
  });

  // عناصر الواجهة
  $(wrapper).html(`
    <div class="flex gap-4" style="padding:12px;">
      <div class="w-1/5">
        <div class="mb-2 font-semibold">Restaurant</div>
        <div id="roe-restaurant"></div>
        <div class="mt-4 mb-2 font-semibold">Tables</div>
        <div id="roe-tables" class="grid gap-2"></div>
      </div>

      <div class="w-2/5">
        <div class="flex items-center justify-between mb-2">
          <div class="font-semibold">Order</div>
          <div>
            <button class="btn btn-sm btn-primary" id="roe-save">Save</button>
            <button class="btn btn-sm btn-success" id="roe-submit">Submit</button>
            <button class="btn btn-sm btn-danger" id="roe-cancel">Cancel</button>
          </div>
        </div>
        <div class="border rounded p-2" id="roe-order">
          <div class="text-sm text-muted" id="roe-order-head">Select a table to start…</div>
          <table class="table table-bordered mt-2" style="display:none;" id="roe-items">
            <thead>
              <tr>
                <th style="width:40%;">Item</th>
                <th style="width:20%;">Qty</th>
                <th style="width:20%;">Rate</th>
                <th style="width:20%;">Amount</th>
                <th style="width:40px;"></th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
          <div class="flex justify-end gap-4 mt-2" id="roe-totals" style="display:none;">
            <div><b>Net</b>: <span id="roe-net">0.00</span></div>
            <div><b>Taxes</b>: <span id="roe-tax">0.00</span></div>
            <div><b>Grand</b>: <span id="roe-grand">0.00</span></div>
          </div>
        </div>
      </div>

      <div class="w-2/5">
        <div class="flex items-center gap-2 mb-2">
          <div class="font-semibold">Menu</div>
          <input type="text" class="form-control" style="height:28px;" id="roe-search" placeholder="Search…">
        </div>
        <div class="border rounded p-2 grid gap-2" id="roe-menu" style="min-height:300px;"></div>
      </div>
    </div>
  `);

  // Link control لاختيار المطعم
  const $rest_holder = $(wrapper).find('#roe-restaurant');
  const rest_control = frappe.ui.form.make_control({
    df: {
      fieldtype: 'Link',
      options: 'Restaurant',
      label: 'Restaurant',
      onchange: () => refresh_all()
    },
    parent: $rest_holder,
    render_input: true
  });
  rest_control.set_value('');

  // حالة الصفحة
  let state = {
    restaurant: null,
    table: null,
    price_list: null,
    menu: null,
    invoice: null // كامل الـ SI ككائن
  };

  // EVENTS
  $('#roe-search', wrapper).on('input', frappe.utils.debounce(() => {
    load_menu();
  }, 250));

  $('#roe-save', wrapper).on('click', async () => {
    if (!state.invoice) return;
    await call('hotel.api.restaurant.save_invoice', { invoice: state.invoice.name });
    await refresh_order(); frappe.show_alert('Saved');
  });

  $('#roe-submit', wrapper).on('click', async () => {
    if (!state.invoice) return;
    await call('hotel.api.restaurant.submit_invoice', { invoice: state.invoice.name });
    state.invoice = null;
    render_order(null);
    await load_tables(); // تحديث حالة الترابيزة
    frappe.show_alert('Submitted');
  });

  $('#roe-cancel', wrapper).on('click', async () => {
    if (!state.invoice) return;
    await call('hotel.api.restaurant.cancel_invoice', { invoice: state.invoice.name });
    state.invoice = null;
    render_order(null);
    await load_tables();
    frappe.show_alert('Cancelled');
  });

  // HELPERS
  function call(method, args) {
    return frappe.call({ method, args }).then(r => r.message);
  }

  async function refresh_all() {
    state.restaurant = rest_control.get_value() || null;
    await Promise.all([load_tables(), resolve_menu()]);
    await load_menu();
  }

  async function load_tables() {
    const rows = await call('hotel.api.restaurant.list_tables', { restaurant: state.restaurant });
    const $wrap = $('#roe-tables', wrapper).empty();
    rows.forEach(t => {
      const color =
        t.status === 'Seated' ? 'bg-orange-100'
        : t.status === 'Dirty' ? 'bg-red-100'
        : t.status === 'Reserved' ? 'bg-yellow-100'
        : 'bg-green-100';

      const $btn = $(`<button class="btn btn-default w-full ${color} text-left">
          <div><b>${frappe.utils.escape_html(t.label || t.name)}</b></div>
          <div class="text-muted text-xs">${frappe.utils.escape_html(t.status || 'Free')}</div>
        </button>`).appendTo($wrap);

      $btn.on('click', async () => {
        state.table = t.name;
        await open_order();
      });
    });
  }

  async function resolve_menu() {
    const info = await call('hotel.api.restaurant.get_active_menu', { restaurant: state.restaurant });
    state.price_list = info && info.price_list ? info.price_list : null;
    state.menu = info && info.menu ? info.menu : null;
  }

  async function load_menu() {
    const q = $('#roe-search', wrapper).val() || null;
    const items = await call('hotel.api.restaurant.list_menu_items', {
      menu: state.menu, price_list: state.price_list, search: q
    });
    const $wrap = $('#roe-menu', wrapper).empty();
    items.forEach(it => {
      const $card = $(`<div class="border rounded p-2 cursor-pointer hover:bg-gray-50">
        <div><b>${frappe.utils.escape_html(it.item_name || it.item_code)}</b></div>
        <div class="text-muted text-xs">${it.item_code}</div>
        <div class="mt-1"><b>${format_currency(it.rate)}</b></div>
      </div>`).appendTo($wrap);
      $card.on('click', async () => {
        if (!state.table) {
          frappe.msgprint('اختر ترابيزة أولًا'); return;
        }
        await call('hotel.api.restaurant.add_item', {
          invoice: state.invoice ? state.invoice.name : null,
          restaurant: state.restaurant,
          table: state.table,
          item_code: it.item_code,
          qty: 1
        }).then(async (msg) => {
          state.invoice = msg.invoice;
          render_order(state.invoice);
        });
      });
    });
  }

  async function open_order() {
    const res = await call('hotel.api.restaurant.open_or_get_order', {
      restaurant: state.restaurant, table: state.table
    });
    state.invoice = res.invoice || null;
    render_order(state.invoice);
  }

  async function refresh_order() {
    if (!state.invoice) return;
    const res = await call('hotel.api.restaurant.get_invoice', { invoice: state.invoice.name });
    state.invoice = res.invoice || null;
    render_order(state.invoice);
  }

  function render_order(si) {
    const $head = $('#roe-order-head', wrapper);
    const $table = $('#roe-items', wrapper);
    const $tbody = $('#roe-items tbody', wrapper).empty();
    const $totals = $('#roe-totals', wrapper);

    if (!si) {
      $head.text('Select a table to start…').show();
      $table.hide(); $totals.hide();
      return;
    }
    $head.text(`Invoice: ${si.name} — Customer: ${si.customer}`).show();
    $table.show(); $totals.show();

    (si.items || []).forEach((row, idx) => {
      const $tr = $(`
        <tr>
          <td>${frappe.utils.escape_html(row.item_name || row.item_code)}</td>
          <td>
            <div class="input-group input-group-sm">
              <button class="btn btn-default minus">-</button>
              <input type="number" class="form-control qty" value="${row.qty}" step="1" min="0">
              <button class="btn btn-default plus">+</button>
            </div>
          </td>
          <td>${format_currency(row.rate)}</td>
          <td>${format_currency(row.amount)}</td>
          <td><button class="btn btn-xs btn-danger del">✕</button></td>
        </tr>
      `).appendTo($tbody);

      $('.minus', $tr).on('click', async () => {
        const newq = Math.max(0, (parseFloat($('.qty', $tr).val()) || 0) - 1);
        await set_qty(idx, newq);
      });
      $('.plus', $tr).on('click', async () => {
        const newq = (parseFloat($('.qty', $tr).val()) || 0) + 1;
        await set_qty(idx, newq);
      });
      $('.qty', $tr).on('change', async () => {
        const newq = Math.max(0, parseFloat($('.qty', $tr).val()) || 0);
        await set_qty(idx, newq);
      });
      $('.del', $tr).on('click', async () => {
        await set_qty(idx, 0);
      });
    });

    $('#roe-net', wrapper).text(format_currency(si.net_total || 0));
    $('#roe-tax', wrapper).text(format_currency((si.taxes_and_charges_added || 0) + (si.taxes_and_charges_deducted || 0)));
    $('#roe-grand', wrapper).text(format_currency(si.grand_total || 0));
  }

  async function set_qty(idx, qty) {
    if (!state.invoice) return;
    const res = await call('hotel.api.restaurant.set_row_qty', {
      invoice: state.invoice.name, row_idx: idx, qty: qty
    });
    state.invoice = res.invoice;
    render_order(state.invoice);
  }

  function format_currency(v) {
    return format_currency ? format_currency(v) : (v || 0).toFixed(2);
  }

  // أول تحميل
  refresh_all();
};
