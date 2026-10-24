const { withAndroidColors, withAndroidStyles } = require('@expo/config-plugins');
module.exports = function withBrandTheme(config) {
  config = withAndroidColors(config, value => {
    const colors = value.modResults.resources.color ??= [];
    const existing = colors.find(item => item.$.name === 'nutriflow_accent');
    if (existing) existing._ = '#315AD9';
    else colors.push({ $: { name: 'nutriflow_accent' }, _: '#315AD9' });
    return value;
  });
  return withAndroidStyles(config, value => {
    const theme = value.modResults.resources.style?.find(item => item.$.name === 'AppTheme');
    if (!theme) throw new Error('Android AppTheme is missing');
    const items = theme.item ??= [];
    const existing = items.find(item => item.$.name === 'colorAccent');
    if (existing) existing._ = '@color/nutriflow_accent';
    else items.push({ $: { name: 'colorAccent' }, _: '@color/nutriflow_accent' });
    return value;
  });
};
