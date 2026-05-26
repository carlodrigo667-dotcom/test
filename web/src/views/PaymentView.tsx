import { useEffect, useMemo, useState } from 'react';
import { api, apiWithRetry } from '@/lib/api';
import {
  downloadRdpFile,
  formatCartState,
  formatConfidence,
  formatModeSegment,
  formatNodeLabel,
  formatSlotLabel,
  getCartState,
  getNodeMode,
  getNodeSlot,
  getStateConfidence,
  getTicketCount,
  isActionableNode,
  isDisputedNode
} from '@/lib/format';
import type { NodeRecord, PaymentCartState, PaymentGuide, PaymentPassenger, PaymentRequestResponse, WorkstationPayload } from '@/types';

interface PaymentViewProps {
  connected: boolean;
  nodes: NodeRecord[];
  initialNodeId?: number | null;
  onOpenNode: (nodeId: number) => void;
  onOpenLogs: (nodeId: number) => void;
}

type BusyState = 'pay' | 'attach' | 'detach' | 'open' | null;
type PaymentPhase = 'idle' | 'queued' | 'modified' | 'failed';

const MIN_PAYMENT_ADULTS = 0;
const MIN_PAYMENT_PARTICIPANTS = 8;
const GUIDE_COUNT = 1;
const INDIVIDUAL_MIN_PAYMENT_PARTICIPANTS = 1;
const PAYMENT_PASSENGER_AUTOFILL_ENABLED = false;

function blankPassenger(type: 'adult' | 'child'): PaymentPassenger {
  return { firstName: '', lastName: '', type };
}

function normalizePassenger(entry: any, type: 'adult' | 'child'): PaymentPassenger | null {
  const firstName = String(entry?.firstName || '').trim();
  const lastName = String(entry?.lastName || '').trim();
  if (!firstName && !lastName) return null;
  return { firstName, lastName, type };
}

function buildPassengerDefaults(config: any, adults: number, children: number) {
  const configured = Array.isArray(config?.participants) ? config.participants : [];
  const adultDefaults = configured
    .filter((entry: any) => String(entry?.type || 'adult').toLowerCase() === 'adult')
    .map((entry: any) => normalizePassenger(entry, 'adult'))
    .filter(Boolean) as PaymentPassenger[];
  const childDefaults = configured
    .filter((entry: any) => String(entry?.type || '').toLowerCase() === 'child')
    .map((entry: any) => normalizePassenger(entry, 'child'))
    .filter(Boolean) as PaymentPassenger[];
  const guideSource = config?.guide || configured.find((entry: any) => String(entry?.type || '').toLowerCase() === 'guide') || {};
  const guide: PaymentGuide = {
    firstName: String(guideSource.firstName || '').trim(),
    lastName: String(guideSource.lastName || '').trim(),
    licenseNumber: String(guideSource.licenseNumber || guideSource.license || guideSource.cardNumber || '').trim()
  };

  return {
    passengers: [
      ...Array.from({ length: adults }, (_, index) => adultDefaults[index] || blankPassenger('adult')),
      ...Array.from({ length: children }, (_, index) => childDefaults[index] || blankPassenger('child'))
    ],
    guide
  };
}

function resizePassengers(current: PaymentPassenger[], config: any, adults: number, children: number) {
  const defaults = buildPassengerDefaults(config, adults, children).passengers;
  const currentAdults = current.filter((entry) => entry.type === 'adult');
  const currentChildren = current.filter((entry) => entry.type === 'child');
  return [
    ...Array.from({ length: adults }, (_, index) => currentAdults[index] || defaults[index] || blankPassenger('adult')),
    ...Array.from({ length: children }, (_, index) => currentChildren[index] || defaults[adults + index] || blankPassenger('child'))
  ];
}

function groupSlots(nodes: NodeRecord[]) {
  return nodes.reduce<Record<string, NodeRecord[]>>((acc, node) => {
    const slot = getNodeSlot(node) || 'without-slot';
    acc[slot] = acc[slot] || [];
    acc[slot].push(node);
    return acc;
  }, {});
}

function parseTicketQuantity(text: string, labelPatterns: string[]) {
  for (const pattern of labelPatterns) {
    const qtyBefore = new RegExp(`(\\d+)\\s*x\\s*[^,;\\n]*${pattern}`, 'i');
    const beforeMatch = text.match(qtyBefore);
    if (beforeMatch) return Number(beforeMatch[1]) || 0;

    const qtyAfter = new RegExp(`${pattern}[^,;\\n]{0,80}?(?:qty|quantity)["']?\\s*[:=]\\s*(\\d+)`, 'i');
    const afterMatch = text.match(qtyAfter);
    if (afterMatch) return Number(afterMatch[1]) || 0;
  }

  return 0;
}

function parsePaymentCounts(text: string) {
  const lines = String(text || '').split(/\r?\n/).reverse();
  for (const line of lines) {
    if (!/\[PAYMENT\]\s+(cart_modified|checkout_ready)\b/i.test(line)) continue;
    const adults = Number(line.match(/\badults=(\d+)/i)?.[1] || 0) || 0;
    const children = Number(line.match(/\bchildren=(\d+)/i)?.[1] || 0) || 0;
    const guideMatch = line.match(/\bguide=(\d+)/i);
    const guide = guideMatch ? Math.max(0, Number(guideMatch[1]) || 0) : GUIDE_COUNT;
    if (adults || children) return { adults, children, guide };
  }
  return null;
}

function getPaymentMode(node?: NodeRecord | null, desired?: Record<string, any> | null) {
  return String(
    desired?.mode
    || node?.displayMode
    || node?.derivedState?.runtimeMode
    || node?.derivedState?.expectedMode
    || node?.extra?.runtimeMode
    || node?.extra?.mode
    || node?.extra?.expectedMode
    || getNodeMode(node as NodeRecord)
    || 'group'
  ).toLowerCase();
}

function getPaymentTicketSearchMode(node?: NodeRecord | null, desired?: Record<string, any> | null) {
  return String(
    desired?.ticketSearchMode
    || desired?.ticket_search_mode
    || node?.extra?.ticketSearchMode
    || node?.extra?.ticket_search_mode
    || node?.extra?.runtimeTicketSearchMode
    || node?.extra?.expectedTicketSearchMode
    || 'dynamic'
  ).toLowerCase() === 'concrete' ? 'concrete' : 'dynamic';
}

function buildPaymentCart(node?: NodeRecord | null, desired?: Record<string, any> | null): PaymentCartState {
  const mode = getPaymentMode(node, desired);
  const ticketSearchMode = getPaymentTicketSearchMode(node, desired);
  const sourceText = [
    node?.cart_items,
    node?.extra?.cartItems,
    node?.extra?.cart_items,
    node?.extra?.lastCartItems,
    node?.derivedState?.lastEvidence,
    node?.operatorState?.source
  ].filter(Boolean).join('\n');

  const paymentCounts = parsePaymentCounts(sourceText);
  const adultsFromCart = paymentCounts?.adults ?? parseTicketQuantity(sourceText, ['intero']);
  const childrenFromCart = paymentCounts?.children ?? parseTicketQuantity(sourceText, ['under\\s*18', 'ridotto', 'child']);
  const guideFromCart = paymentCounts?.guide ?? parseTicketQuantity(sourceText, ['guide']);
  const ticketCount = getTicketCount(node);
  const rawDerivedGuide = node?.derivedState?.guideCount;
  const derivedGuide = rawDerivedGuide === null || rawDerivedGuide === undefined ? NaN : Number(rawDerivedGuide);
  const guideCount = mode === 'individual'
    ? 0
    : (Number.isFinite(derivedGuide) ? Math.max(0, derivedGuide) : (guideFromCart || GUIDE_COUNT));
  const fallbackAdults = ticketCount > guideCount ? Math.max(0, ticketCount - guideCount - childrenFromCart) : 0;
  const caughtAdults = Number(node?.derivedState?.cartAdults || 0) || adultsFromCart || Number(node?.extra?.caughtAdults || 0) || fallbackAdults;
  const caughtChildren = Number(node?.derivedState?.cartChildren || 0) || childrenFromCart || Number(node?.extra?.caughtChildren || 0) || 0;
  const caughtNonGuide = caughtAdults + caughtChildren;

  return {
    caughtAdults,
    caughtChildren,
    caughtNonGuide,
    guideCount,
    totalTickets: caughtNonGuide + guideCount,
    mode,
    ticketSearchMode,
    slot: getNodeSlot(node),
    confidence: getStateConfidence(node),
    source: paymentCounts ? 'payment_marker' : ((adultsFromCart || childrenFromCart) ? 'cart_items' : (ticketCount ? 'derived_state' : 'unknown'))
  };
}

function formatCaughtCart(cart: PaymentCartState) {
  const childPart = cart.caughtChildren > 0 ? ` + ${cart.caughtChildren} дет.` : '';
  const guidePart = cart.guideCount > 0 ? ` + ${cart.guideCount} гид` : '';
  return `${cart.caughtAdults || 0} взр.${childPart}${guidePart}`;
}

function markerMatches(line: string, adults: number, children: number) {
  return line.includes(`adults=${adults}`) && line.includes(`children=${children}`);
}

function getCaughtNonGuide(cart: PaymentCartState) {
  return Number(cart.caughtNonGuide ?? (cart.caughtAdults + cart.caughtChildren)) || 0;
}

function isIndividualCart(cart: PaymentCartState) {
  return String(cart.mode || '').toLowerCase() === 'individual';
}

function getMinimumParticipants(cart: PaymentCartState) {
  return isIndividualCart(cart) ? INDIVIDUAL_MIN_PAYMENT_PARTICIPANTS : MIN_PAYMENT_PARTICIPANTS;
}

function isConcreteCheckoutOnly(cart: PaymentCartState, adults: number, children: number) {
  return String(cart.ticketSearchMode || '').toLowerCase() === 'concrete'
    && adults === (Number(cart.caughtAdults) || 0)
    && children === (Number(cart.caughtChildren) || 0);
}

function formatRequestedCart(adults: number, children: number, guide: number) {
  const childPart = children > 0 ? ` + ${children} дет.` : '';
  const guidePart = guide > 0 ? ` + ${guide} гид` : '';
  return `${adults || 0} взр.${childPart}${guidePart}`;
}

function getPaymentMarker(
  snapshot: WorkstationPayload['logs'] | undefined,
  sinceSeq: number,
  adults: number,
  children: number
) {
  const lines = [...(snapshot?.lines || [])].reverse();

  for (const entry of lines) {
    if ((entry.seq || 0) <= sinceSeq) continue;
    const line = String(entry.line || '');
    if (!line.includes('[PAYMENT]')) continue;

    if (line.includes('passenger_fill_failed')) {
      return { phase: 'failed' as const, message: line };
    }

    if (!markerMatches(line, adults, children)) continue;

    if (line.includes('cart_modify_failed')) {
      return { phase: 'failed' as const, message: line };
    }

    if (line.includes('checkout_ready')) {
      return { phase: 'modified' as const, message: line };
    }
  }

  return null;
}

function validatePaymentForm(cart: PaymentCartState, adults: number, children: number) {
  if (!Number.isInteger(adults) || adults < MIN_PAYMENT_ADULTS) return `Adults must be an integer from ${MIN_PAYMENT_ADULTS}.`;
  if (!Number.isInteger(children) || children < 0) return 'Children must be an integer from 0.';
  const checkoutOnly = isConcreteCheckoutOnly(cart, adults, children);
  const minParticipants = getMinimumParticipants(cart);
  if (!checkoutOnly && adults + children < minParticipants) {
    const totalMinimum = minParticipants + Math.max(0, Number(cart.guideCount || 0));
    return isIndividualCart(cart)
      ? `Minimum is ${totalMinimum} individual ticket.`
      : `Minimum is ${totalMinimum} tickets total including guide.`;
  }
  const caughtNonGuide = getCaughtNonGuide(cart);
  if (caughtNonGuide > 0 && adults + children > caughtNonGuide) return `Requested ${adults + children} tickets, but only ${caughtNonGuide} caught non-guide slots are editable.`;
  return null;
}

function validatePassengerForm(passengers: PaymentPassenger[], guide: PaymentGuide, adults: number, children: number) {
  if (!PAYMENT_PASSENGER_AUTOFILL_ENABLED) return null;
  const expected = adults + children;
  if (passengers.length !== expected) return `Нужно заполнить данные для ${expected} билетов.`;
  const missingIndex = passengers.findIndex((entry) => !entry.firstName.trim() || !entry.lastName.trim());
  if (missingIndex >= 0) return `Заполните имя и фамилию для билета #${missingIndex + 1}.`;
  if (!guide.firstName.trim() || !guide.lastName.trim()) return 'Заполните имя и фамилию гида.';
  if (!guide.licenseNumber.trim()) return 'Заполните номер удостоверения гида.';
  return null;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function PaymentView({ connected, nodes, initialNodeId, onOpenNode, onOpenLogs }: PaymentViewProps) {
  const paymentNodes = useMemo(() => nodes.filter((node) => isActionableNode(node)), [nodes]);
  const disputedNodes = useMemo(() => {
    return nodes.filter((node) => !isActionableNode(node) && isDisputedNode(node) && Boolean(getNodeSlot(node)));
  }, [nodes]);

  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(initialNodeId || paymentNodes[0]?.id || null);
  const [payload, setPayload] = useState<WorkstationPayload | null>(null);
  const [busy, setBusy] = useState<BusyState>(null);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [adultCount, setAdultCount] = useState(MIN_PAYMENT_ADULTS);
  const [childCount, setChildCount] = useState(0);
  const [paymentPhase, setPaymentPhase] = useState<PaymentPhase>('idle');
  const [lastCheckoutOnly, setLastCheckoutOnly] = useState(false);
  const [configDefaults, setConfigDefaults] = useState<any>(null);
  const [passengers, setPassengers] = useState<PaymentPassenger[]>([]);
  const [guideDetails, setGuideDetails] = useState<PaymentGuide>({ firstName: '', lastName: '', licenseNumber: '' });

  useEffect(() => {
    if (!paymentNodes.length) {
      setSelectedNodeId(null);
      setPayload(null);
      return;
    }

    if (initialNodeId && paymentNodes.some((node) => node.id === initialNodeId)) {
      setSelectedNodeId(initialNodeId);
      return;
    }

    if (!paymentNodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(paymentNodes[0].id);
    }
  }, [paymentNodes, initialNodeId, selectedNodeId]);

  useEffect(() => {
    if (!selectedNodeId) return;
    let cancelled = false;
    setError(null);

    apiWithRetry<WorkstationPayload>(`/workstation/${selectedNodeId}`)
      .then((next) => {
        if (!cancelled) setPayload(next);
      })
      .catch((nextError: any) => {
        if (!cancelled) setError(nextError.message || 'Не удалось загрузить платёжный терминал.');
      });

    return () => {
      cancelled = true;
    };
  }, [selectedNodeId, connected]);

  useEffect(() => {
    let cancelled = false;
    apiWithRetry<any>('/config')
      .then((nextConfig) => {
        if (!cancelled) setConfigDefaults(nextConfig);
      })
      .catch(() => {
        if (!cancelled) setConfigDefaults(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedNode = paymentNodes.find((node) => node.id === selectedNodeId) || payload?.node || null;
  const selectedCart = useMemo(() => {
    if (payload?.node?.id === selectedNodeId && payload.paymentCart) return payload.paymentCart;
    return buildPaymentCart(selectedNode, payload?.desired);
  }, [payload, selectedNode, selectedNodeId]);
  const groupedSlots = useMemo(() => groupSlots(paymentNodes), [paymentNodes]);
  const formError = modalOpen ? validatePaymentForm(selectedCart, adultCount, childCount) : null;
  const passengerError = modalOpen ? validatePassengerForm(passengers, guideDetails, adultCount, childCount) : null;
  const selectedGuideCount = Math.max(0, Number(selectedCart.guideCount || 0));
  const selectedIsIndividual = isIndividualCart(selectedCart);
  const checkoutOnlyAction = modalOpen ? isConcreteCheckoutOnly(selectedCart, adultCount, childCount) : false;

  const refreshPayload = async (nodeId: number) => {
    const next = await apiWithRetry<WorkstationPayload>(`/workstation/${nodeId}`);
    setPayload(next);
    return next;
  };

  const openPaymentModal = () => {
    const cart = selectedCart;
    const caughtNonGuide = getCaughtNonGuide(cart);
    const nextAdults = caughtNonGuide > 0 ? cart.caughtAdults : getMinimumParticipants(cart);
    const nextChildren = isIndividualCart(cart) ? 0 : (caughtNonGuide > 0 ? cart.caughtChildren : 0);
    const defaults = buildPassengerDefaults(configDefaults, nextAdults, nextChildren);
    setAdultCount(nextAdults);
    setChildCount(nextChildren);
    setPassengers(defaults.passengers);
    setGuideDetails(defaults.guide);
    setPaymentPhase('idle');
    setLastCheckoutOnly(false);
    setError(null);
    setModalOpen(true);
  };

  useEffect(() => {
    if (!modalOpen) return;
    if (isIndividualCart(selectedCart) && childCount !== 0) {
      setChildCount(0);
      return;
    }
    setPassengers((current) => resizePassengers(current, configDefaults, adultCount, childCount));
    setGuideDetails((current) => {
      if (current.firstName || current.lastName || current.licenseNumber) return current;
      return buildPassengerDefaults(configDefaults, adultCount, childCount).guide;
    });
  }, [adultCount, childCount, configDefaults, modalOpen, selectedCart]);

  const updatePassenger = (index: number, field: 'firstName' | 'lastName', value: string) => {
    setPassengers((current) => current.map((entry, entryIndex) => (
      entryIndex === index ? { ...entry, [field]: value } : entry
    )));
  };

  const updateGuide = (field: keyof PaymentGuide, value: string) => {
    setGuideDetails((current) => ({ ...current, [field]: value }));
  };

  const waitForPaymentConfirmation = async (nodeId: number, sinceSeq: number, adults: number, children: number) => {
    for (let attempt = 0; attempt < 45; attempt += 1) {
      await sleep(2000);
      const next = await refreshPayload(nodeId);
      const marker = getPaymentMarker(next.logs, sinceSeq, adults, children);
      if (marker) return marker;
    }

    return null;
  };

  const runPaymentRequest = async () => {
    if (!selectedNodeId) return;
    const validationError = validatePaymentForm(selectedCart, adultCount, childCount);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (PAYMENT_PASSENGER_AUTOFILL_ENABLED) {
      const detailsValidationError = validatePassengerForm(passengers, guideDetails, adultCount, childCount);
      if (detailsValidationError) {
        setError(detailsValidationError);
        return;
      }
    }

    const sinceSeq = payload?.logs?.seq || 0;
    const guideCount = Math.max(0, Number(selectedCart.guideCount || 0));
    const checkoutOnly = isConcreteCheckoutOnly(selectedCart, adultCount, childCount);
    setLastCheckoutOnly(checkoutOnly);
    setBusy('pay');
    setPaymentPhase('queued');
    setError(null);
    setStatusText(checkoutOnly
      ? 'Команда отправлена боту. Открываем checkout без изменения корзины.'
      : (PAYMENT_PASSENGER_AUTOFILL_ENABLED
        ? 'Команда отправлена боту. Изменяем корзину...'
        : 'Команда отправлена боту. Изменяем корзину, автозаполнение имён временно отключено.')
    );

    try {
      await api<PaymentRequestResponse>(`/nodes/${selectedNodeId}/pay`, {
        method: 'POST',
        body: {
          adults: adultCount,
          children: childCount,
          guide: guideCount,
          checkoutOnly,
          ...(PAYMENT_PASSENGER_AUTOFILL_ENABLED ? { participants: passengers, guideDetails } : {}),
          source: 'web'
        }
      });

      const marker = await waitForPaymentConfirmation(selectedNodeId, sinceSeq, adultCount, childCount);

      if (marker?.phase === 'failed') {
        setPaymentPhase('failed');
        throw new Error('Бот не смог изменить корзину. Детали есть в логах выбранного узла.');
      }

      if (marker?.phase === 'modified') {
        setPaymentPhase('modified');
        setStatusText(checkoutOnly
          ? 'Checkout открыт без изменения корзины. Завершите оплату вручную через noVNC или RDP.'
          : (PAYMENT_PASSENGER_AUTOFILL_ENABLED
            ? 'Корзина изменена, данные билетов отправлены. Откройте noVNC или скачайте RDP для оплаты.'
            : 'Корзина изменена. Автозаполнение имён отключено, завершите оплату вручную через noVNC или RDP.')
        );
      } else {
        setStatusText(checkoutOnly
          ? 'Команда отправлена, но подтверждение checkout ещё не пришло в логи.'
          : (PAYMENT_PASSENGER_AUTOFILL_ENABLED
            ? 'Команда отправлена, но подтверждение изменения корзины ещё не пришло в логи.'
            : 'Команда отправлена, но подтверждение изменения корзины ещё не пришло в логи. Имена нужно будет ввести вручную.')
        );
      }
    } catch (nextError: any) {
      setPaymentPhase('failed');
      setError(nextError.message || 'Не удалось отправить команду оплаты.');
    } finally {
      setBusy(null);
    }
  };

  const attachVnc = async () => {
    if (!selectedNodeId) return;
    setBusy('attach');
    setError(null);

    try {
      const next = await api<{ ok: boolean; session: WorkstationPayload['session'] }>(`/workstation/${selectedNodeId}/attach`, {
        method: 'POST'
      });
      setPayload((current) => (current ? { ...current, session: next.session } : current));
      setStatusText(`noVNC подключён к ${formatNodeLabel(selectedNodeId)}.`);
    } catch (nextError: any) {
      setError(nextError.message || 'Не удалось подключить noVNC.');
    } finally {
      setBusy(null);
    }
  };

  const openVncInNewTab = async () => {
    if (!selectedNodeId) return;
    setBusy('open');
    setError(null);

    try {
      let nextSession = payload?.session || null;

      if (!nextSession?.iframeUrl) {
        const response = await api<{ ok: boolean; session: WorkstationPayload['session'] }>(`/workstation/${selectedNodeId}/attach`, {
          method: 'POST'
        });
        nextSession = response.session || null;
        setPayload((current) => (current ? { ...current, session: nextSession } : current));
      }

      if (!nextSession?.iframeUrl) throw new Error('Не удалось получить ссылку noVNC для нового окна.');
      const opened = window.open(nextSession.iframeUrl, '_blank', 'noopener,noreferrer');
      if (!opened) throw new Error('Браузер заблокировал новое окно noVNC.');
      setStatusText(`noVNC открыт в новом окне для ${formatNodeLabel(selectedNodeId)}.`);
    } catch (nextError: any) {
      setError(nextError.message || 'Не удалось открыть noVNC в новом окне.');
    } finally {
      setBusy(null);
    }
  };

  const detachVnc = async () => {
    if (!selectedNodeId) return;
    setBusy('detach');
    setError(null);

    try {
      await api(`/vnc/${selectedNodeId}`, { method: 'DELETE' });
      setPayload((current) => (current ? { ...current, session: null } : current));
      setStatusText(`VNC закрыт для ${formatNodeLabel(selectedNodeId)}.`);
    } catch (nextError: any) {
      setError(nextError.message || 'Не удалось закрыть VNC.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page-stack">
      <section className="panel page-hero">
        <div className="panel-toolbar">
          <div className="panel-title-block">
            <h2>Оплата</h2>
            <span className="panel-caption">
              Платёжный терминал показывает только корзины, подтверждённые логами. Heartbeat-сигналы без доказательства остаются в диагностике.
            </span>
          </div>
        </div>

        <div className="kpi-grid compact-kpi-grid">
          <article className="kpi-card">
            <span className="kpi-label">Корзины к оплате</span>
            <strong className="kpi-value">{paymentNodes.length}</strong>
            <span className="kpi-sub">Можно менять количество и переводить в checkout</span>
          </article>
          <article className="kpi-card">
            <span className="kpi-label">Спорные сигналы</span>
            <strong className="kpi-value">{disputedNodes.length}</strong>
            <span className="kpi-sub">Не показываются как готовые к оплате без подтверждения логом</span>
          </article>
          <article className="kpi-card">
            <span className="kpi-label">Слоты в работе</span>
            <strong className="kpi-value">{Object.keys(groupedSlots).filter((slot) => slot !== 'without-slot').length}</strong>
            <span className="kpi-sub">Только активные подтверждённые корзины</span>
          </article>
        </div>
      </section>

      {error ? <div className="panel panel-danger">{error}</div> : null}
      {statusText ? <div className="panel panel-success">{statusText}</div> : null}

      {paymentNodes.length === 0 ? (
        <div className="panel empty-state">
          Сейчас нет подтверждённых корзин для оплаты.
          {disputedNodes.length > 0 ? ` Спорных heartbeat-сигналов: ${disputedNodes.length}.` : ''}
        </div>
      ) : (
        <>
          <section className="overview-main-grid">
            <article className="panel">
              <div className="panel-toolbar">
                <div className="panel-title-block">
                  <h3>Платёжный терминал</h3>
                  <span className="panel-caption">Выберите узел, задайте количество билетов и откройте рабочий стол для оплаты</span>
                </div>
              </div>

              <label className="field">
                <span>Узел для оплаты</span>
                <select
                  className="select-input"
                  value={selectedNodeId || ''}
                  onChange={(event) => {
                    setSelectedNodeId(Number(event.target.value));
                    setPaymentPhase('idle');
                    setModalOpen(false);
                  }}
                >
                  {paymentNodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {formatNodeLabel(node.id)} / {node.ip} / {formatCartState(getCartState(node))}
                    </option>
                  ))}
                </select>
              </label>

              {selectedNode ? (
                <div className="payment-node-meta">
                  <div className="chip tone-muted">{selectedNode.ip}</div>
                  <div className="chip tone-muted">{formatModeSegment(getNodeMode(selectedNode))}</div>
                  <div className="chip tone-muted">{formatCartState(getCartState(selectedNode))}</div>
                  <div className="chip tone-muted">{getNodeSlot(selectedNode) ? formatSlotLabel(getNodeSlot(selectedNode)) : 'без слота'}</div>
                  <div className="chip tone-muted">{formatConfidence(getStateConfidence(selectedNode))}</div>
                  <div className="chip tone-info">Поймано: {formatCaughtCart(selectedCart)}</div>
                </div>
              ) : null}

              <div className="action-matrix compact-action-matrix">
                <button type="button" className="action-btn accent" disabled={busy === 'pay' || !selectedNode} onClick={openPaymentModal}>
                  {busy === 'pay' ? (lastCheckoutOnly ? 'Открываем checkout...' : 'Изменяем корзину...') : 'Оплатить'}
                </button>
                <button type="button" className="action-btn" disabled={busy === 'attach'} onClick={() => void attachVnc()}>
                  {busy === 'attach' ? 'Подключение...' : 'Открыть noVNC для оплаты'}
                </button>
                <button type="button" className="action-btn" disabled={busy === 'open'} onClick={() => void openVncInNewTab()}>
                  {busy === 'open' ? 'Подготовка...' : 'Открыть noVNC в новом окне'}
                </button>
                <button type="button" className="action-btn" disabled={busy === 'detach'} onClick={() => void detachVnc()}>
                  {busy === 'detach' ? 'Закрытие...' : 'Закрыть VNC'}
                </button>
                <button type="button" className="action-btn" disabled={!selectedNode} onClick={() => selectedNode && downloadRdpFile(selectedNode)}>
                  Скачать RDP для оплаты
                </button>
                <button type="button" className="action-btn" disabled={!selectedNodeId} onClick={() => selectedNodeId && onOpenNode(selectedNodeId)}>
                  Рабочая станция
                </button>
                <button type="button" className="action-btn" disabled={!selectedNodeId} onClick={() => selectedNodeId && onOpenLogs(selectedNodeId)}>
                  Логи
                </button>
              </div>
            </article>

            <article className="panel panel-vnc">
              <div className="panel-toolbar">
                <div className="panel-title-block">
                  <h3>Встроенный noVNC</h3>
                  <span className="panel-caption">{payload?.session?.iframeUrl ? 'сессия активна' : 'сессия ещё не открыта'}</span>
                </div>
              </div>

              {payload?.session?.iframeUrl ? (
                <div className="vnc-stage">
                  <iframe
                    className="vnc-frame"
                    title={`payment-vnc-${selectedNodeId}`}
                    src={payload.session.iframeUrl}
                    allow="clipboard-read; clipboard-write"
                  />
                </div>
              ) : (
                <div className="empty-state">
                  noVNC-сессия ещё не открыта. Используйте кнопку «Открыть noVNC для оплаты» или откройте noVNC в новом окне.
                </div>
              )}
            </article>
          </section>

          <section className="panel">
            <div className="panel-toolbar">
              <div className="panel-title-block">
                <h3>Подтверждённые корзины</h3>
                <span className="panel-caption">Здесь только узлы, где логи подтверждают живую корзину или checkout</span>
              </div>
            </div>

            <div className="simple-table">
              <div className="simple-table-row header">
                <span>Слот</span>
                <span>Узел</span>
                <span>IP</span>
                <span>Поймано</span>
                <span>Состояние</span>
                <span>Действия</span>
              </div>
              {paymentNodes.map((node) => {
                const cart = buildPaymentCart(node);
                return (
                  <div key={node.id} className="simple-table-row">
                    <span>{formatSlotLabel(getNodeSlot(node))}</span>
                    <span>{formatNodeLabel(node.id)}</span>
                    <span>{node.ip}</span>
                    <span>{formatCaughtCart(cart)}</span>
                    <span>{formatCartState(getCartState(node))}</span>
                    <span className="row-actions-inline">
                      <button type="button" className="mini-btn" onClick={() => setSelectedNodeId(node.id)}>
                        Выбрать
                      </button>
                      <button type="button" className="mini-btn" onClick={() => onOpenLogs(node.id)}>
                        Логи
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}

      {disputedNodes.length > 0 ? (
        <section className="panel">
          <div className="panel-toolbar">
            <div className="panel-title-block">
              <h3>Спорные heartbeat-сигналы</h3>
              <span className="panel-caption">Эти узлы не попали в оплату, потому что свежие логи не подтвердили активную корзину</span>
            </div>
          </div>

          <div className="simple-table">
            <div className="simple-table-row header">
              <span>Узел</span>
              <span>IP</span>
              <span>Последний слот</span>
              <span>Heartbeat</span>
              <span>Действия</span>
            </div>
            {disputedNodes.map((node) => (
              <div key={node.id} className="simple-table-row">
                <span>{formatNodeLabel(node.id)}</span>
                <span>{node.ip}</span>
                <span>{formatSlotLabel(getNodeSlot(node))}</span>
                <span>{formatCartState(getCartState(node))}</span>
                <span className="row-actions-inline">
                  <button type="button" className="mini-btn" onClick={() => onOpenLogs(node.id)}>
                    Логи
                  </button>
                  <button type="button" className="mini-btn" onClick={() => onOpenNode(node.id)}>
                    Станция
                  </button>
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {modalOpen && selectedNode ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="payment-modal panel">
            <div className="panel-toolbar">
              <div className="panel-title-block">
                <h3>Сколько и какие нужны билеты?</h3>
                <span className="panel-caption">{formatNodeLabel(selectedNode.id)} / Поймано: {formatCaughtCart(selectedCart)}</span>
              </div>
              <button type="button" className="mini-btn" onClick={() => setModalOpen(false)}>
                Закрыть
              </button>
            </div>

            {paymentPhase === 'modified' ? (
              <div className="payment-success-box">
                <strong>{lastCheckoutOnly ? 'Checkout открыт' : 'Корзина изменена'}</strong>
                <span>{lastCheckoutOnly ? 'Корзина не изменялась. Откройте рабочий стол и завершите оплату вручную.' : 'Теперь откройте рабочий стол и завершите оплату вручную.'}</span>
                <div className="action-matrix compact-action-matrix">
                  <button type="button" className="action-btn accent" disabled={busy === 'attach'} onClick={() => void attachVnc()}>
                    Открыть noVNC для оплаты
                  </button>
                  <button type="button" className="action-btn" disabled={busy === 'open'} onClick={() => void openVncInNewTab()}>
                    Открыть noVNC в новом окне
                  </button>
                  <button type="button" className="action-btn" onClick={() => downloadRdpFile(selectedNode)}>
                    Скачать RDP для оплаты
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="payment-form-grid">
                  <label className="field">
                    <span>Взрослые билеты</span>
                    <input
                      className="text-input"
                      type="number"
                      min={MIN_PAYMENT_ADULTS}
                      value={adultCount}
                      onChange={(event) => setAdultCount(Number(event.target.value))}
                    />
                  </label>
                  {!selectedIsIndividual ? (
                    <label className="field">
                      <span>Детские билеты</span>
                      <input
                        className="text-input"
                        type="number"
                        min={0}
                        value={childCount}
                        onChange={(event) => setChildCount(Number(event.target.value))}
                      />
                    </label>
                  ) : null}
                  {selectedGuideCount > 0 ? (
                    <div className="payment-guide-lock">
                      <span>Гид</span>
                      <strong>+{selectedGuideCount} всегда</strong>
                    </div>
                  ) : null}
                </div>

                <div className="payment-summary-box">
                  <span>Итого к оплате</span>
                  <strong>{formatRequestedCart(adultCount, childCount, selectedGuideCount)}</strong>
                </div>

                {PAYMENT_PASSENGER_AUTOFILL_ENABLED ? (
                  <section className="payment-passenger-panel">
                    <div className="panel-toolbar compact-toolbar">
                      <div className="panel-title-block">
                        <h4>Данные билетов</h4>
                        <span className="panel-caption">Бот заполнит эти поля до открытия checkout/noVNC.</span>
                      </div>
                    </div>
                    <div className="payment-passenger-grid">
                      {passengers.map((passenger, index) => (
                        <div className="passenger-row" key={`${passenger.type}-${index}`}>
                          <span className="passenger-index">
                            {index + 1}. {passenger.type === 'child' ? 'детский' : 'взрослый'}
                          </span>
                          <input
                            className="text-input"
                            value={passenger.firstName}
                            placeholder="Имя"
                            onChange={(event) => updatePassenger(index, 'firstName', event.target.value)}
                          />
                          <input
                            className="text-input"
                            value={passenger.lastName}
                            placeholder="Фамилия"
                            onChange={(event) => updatePassenger(index, 'lastName', event.target.value)}
                          />
                        </div>
                      ))}
                    </div>
                    {selectedGuideCount > 0 ? (
                      <div className="payment-guide-fields">
                        <span className="passenger-index">Гид + удостоверение</span>
                        <input
                          className="text-input"
                          value={guideDetails.firstName}
                          placeholder="Имя гида"
                          onChange={(event) => updateGuide('firstName', event.target.value)}
                        />
                        <input
                          className="text-input"
                          value={guideDetails.lastName}
                          placeholder="Фамилия гида"
                          onChange={(event) => updateGuide('lastName', event.target.value)}
                        />
                        <input
                          className="text-input"
                          value={guideDetails.licenseNumber}
                          placeholder="Номер удостоверения"
                          onChange={(event) => updateGuide('licenseNumber', event.target.value)}
                        />
                      </div>
                    ) : null}
                  </section>
                ) : (
                  <div className="panel compact-panel">
                    {checkoutOnlyAction
                      ? 'Автозаполнение имён временно отключено. Бот откроет checkout без изменения корзины, имена введите вручную через noVNC или RDP.'
                      : 'Автозаполнение имён временно отключено. Бот изменит количество билетов и откроет checkout, имена введите вручную через noVNC или RDP.'}
                  </div>
                )}

                {formError ? <div className="panel panel-danger compact-panel">{formError}</div> : null}
                {PAYMENT_PASSENGER_AUTOFILL_ENABLED && passengerError ? <div className="panel panel-danger compact-panel">{passengerError}</div> : null}
                {paymentPhase === 'queued' ? (
                  <div className="panel panel-success compact-panel">
                    {checkoutOnlyAction
                      ? 'Открываем checkout без изменения корзины, ждём подтверждение в логах бота...'
                      : (PAYMENT_PASSENGER_AUTOFILL_ENABLED
                        ? 'Изменяем корзину, ждём подтверждение в логах бота...'
                        : 'Изменяем корзину, автозаполнение имён отключено, ждём подтверждение в логах бота...')}
                  </div>
                ) : null}

                <div className="action-matrix compact-action-matrix">
                    <button
                      type="button"
                      className="action-btn accent"
                      disabled={Boolean(formError || (PAYMENT_PASSENGER_AUTOFILL_ENABLED ? passengerError : null)) || busy === 'pay'}
                      onClick={() => void runPaymentRequest()}
                    >
                      {busy === 'pay'
                        ? (checkoutOnlyAction ? 'Открываем checkout...' : 'Изменяем корзину...')
                        : (checkoutOnlyAction
                          ? 'Открыть checkout'
                          : (PAYMENT_PASSENGER_AUTOFILL_ENABLED ? 'Изменить корзину и перейти к оплате' : 'Изменить корзину и открыть checkout'))}
                    </button>
                  <button type="button" className="action-btn" disabled={busy === 'pay'} onClick={() => setModalOpen(false)}>
                    Отмена
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
