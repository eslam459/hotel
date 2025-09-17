frappe.pages['restaurant-order-ent'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Restaurant Order Entry',
		single_column: true
	});
}