function listProviders(ethereum) {
  if (!ethereum) return [];
  if (Array.isArray(ethereum.providers) && ethereum.providers.length > 0) {
    return ethereum.providers;
  }
  return [ethereum];
}

function describeProvider(provider, index) {
  return {
    index,
    isMetaMask: !!provider?.isMetaMask,
    hasNativeMetaMaskApi: !!provider?._metamask,
    isCoinbaseWallet: !!provider?.isCoinbaseWallet,
    isBraveWallet: !!provider?.isBraveWallet,
    isRabby: !!provider?.isRabby,
    isTrust: !!provider?.isTrust,
    selectedAddress: provider?.selectedAddress || "",
  };
}

export function getInjectedProviderDiagnostics() {
  if (typeof window === "undefined") {
    return { hasEthereum: false, selected: null, providers: [] };
  }

  const { ethereum } = window;
  const providers = listProviders(ethereum);
  const diagnostics = providers.map(describeProvider);
  const selected = selectMetaMaskProvider(providers);

  return {
    hasEthereum: !!ethereum,
    selected: selected ? describeProvider(selected, providers.indexOf(selected)) : null,
    providers: diagnostics,
  };
}

function selectMetaMaskProvider(providers) {
  if (!providers.length) return null;

  const realMetaMask = providers.find(
    (provider) => provider?.isMetaMask && provider?._metamask
  );
  if (realMetaMask) return realMetaMask;

  const plainMetaMask = providers.find(
    (provider) =>
      provider?.isMetaMask &&
      !provider?.isCoinbaseWallet &&
      !provider?.isBraveWallet &&
      !provider?.isRabby
  );
  if (plainMetaMask) return plainMetaMask;

  return null;
}

export function getMetaMaskProvider({ requireMetaMask = true } = {}) {
  if (typeof window === "undefined") return null;
  const { ethereum } = window;
  if (!ethereum) return null;

  const providers = listProviders(ethereum);
  const selected = selectMetaMaskProvider(providers);
  const diagnostics = providers.map(describeProvider);

  console.info("[wallet] Injected provider diagnostics", {
    hasEthereum: true,
    selected: selected ? describeProvider(selected, providers.indexOf(selected)) : null,
    providers: diagnostics,
  });

  if (selected) return selected;
  if (!requireMetaMask && providers.length > 0) return providers[0];
  return null;
}
