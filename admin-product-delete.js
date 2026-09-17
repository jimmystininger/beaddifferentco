(() => {
  const isPreviewBranch = () => window.location.hostname.includes('-git-preview-delete-product-page-');

  const addDeleteProductPageButton = () => {
    const form = document.querySelector('#cloud-item-form[data-product-id]');
    if (!form || form.dataset.deletePageReady === 'true') return;
    const productId = String(form.dataset.productId || '').trim();
    if (!productId) return;
    form.dataset.deletePageReady = 'true';

    const actions = form.querySelector('.admin-actions');
    if (!actions) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'admin-delete-product-page';
    button.textContent = 'Delete product page';
    button.style.marginLeft = 'auto';
    actions.append(button);

    button.addEventListener('click', async () => {
      const name = String(form.elements.name?.value || 'this product page').trim();
      const confirmed = window.confirm(
        `Delete the product page “${name}”?\n\n` +
        `This removes the storefront page and its page-specific data.\n` +
        `The underlying inventory SKUs will NOT be deleted or changed.\n\n` +
        `This cannot be undone.`
      );
      if (!confirmed) return;

      // The Vercel preview points at the live Supabase project. Never allow a
      // destructive click on this preview to mutate production data.
      if (isPreviewBranch()) {
        window.alert('Preview only: the delete action was not executed. No product or inventory data was changed.');
        return;
      }

      button.disabled = true;
      button.textContent = 'Deleting…';

      try {
        if (!window.beadSupabase) throw new Error('The store database is not connected.');
        const admin = typeof cloudAdmin === 'function' ? cloudAdmin() : window.beadSupabase;

        // Preserve inventory/accounting history where the FK permits it.
        const history = await admin.from('product_change_history').update({ product_id: null }).eq('product_id', productId);
        if (history.error && !/null|not-null|constraint/i.test(history.error.message || '')) throw history.error;
        const adjustments = await admin.from('inventory_adjustments').update({ product_id: null }).eq('product_id', productId);
        if (adjustments.error && !/null|not-null|constraint/i.test(adjustments.error.message || '')) throw adjustments.error;

        // Delete page-owned Etsy mapping components before the page itself.
        const mappingRows = await admin.from('product_etsy_mappings').select('id').eq('product_id', productId);
        if (mappingRows.error) throw mappingRows.error;
        const mappingIds = (mappingRows.data || []).map(row => row.id).filter(Boolean);
        if (mappingIds.length) {
          const components = await admin.from('product_etsy_mapping_components').delete().in('mapping_id', mappingIds);
          if (components.error) throw components.error;
        }

        const productDelete = await admin.from('products').delete().eq('id', productId).select('id').maybeSingle();
        if (productDelete.error) throw productDelete.error;
        if (!productDelete.data?.id) throw new Error('The product page was not deleted.');

        if (typeof renderItems === 'function') {
          await renderItems();
        } else {
          window.location.href = 'admin.html';
        }
      } catch (error) {
        button.disabled = false;
        button.textContent = 'Delete product page';
        const message = error?.message || 'Unknown error.';
        window.alert(`Product page was not deleted.\n\n${message}`);
      }
    });
  };

  const observer = new MutationObserver(addDeleteProductPageButton);
  observer.observe(document.body, { childList: true, subtree: true });
  addDeleteProductPageButton();
})();
