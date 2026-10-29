import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Colors,
  Spacing,
  FontSize,
  FontWeight,
  BorderRadius,
} from "../../src/constants/theme";
import AppCard from "../../src/components/AppCard";
import AppButton from "../../src/components/AppButton";
import EmptyState from "../../src/components/EmptyState";
import {
  getRecentOrders,
  getOrderItems,
} from "../../src/database/queries/orderQueries";
import { printInvoice, saveInvoicePdf } from "../../src/services/printService";
import { formatCurrency, formatDate, formatTime } from "../../src/utils/helpers";
import { useLanguage } from "../../src/i18n";
import { Order, OrderItem } from "../../src/types/models";

export default function HistoryScreen() {
  const { t } = useLanguage();
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);

  const payLabel = (mode: string) =>
    mode === "card"
      ? t("payment.card")
      : mode === "upi"
        ? t("payment.upi")
        : t("payment.cash");

  const formatDateTime = (dateStr: string) =>
    `${formatDate(dateStr)}, ${formatTime(dateStr)}`;

  useEffect(() => {
    loadOrders();
  }, []);

  const loadOrders = async () => {
    setLoading(true);
    try {
      const data = await getRecentOrders(50);
      setOrders(data);
    } catch (e: any) {
      Alert.alert(t("common.error"), e.message);
    }
    setLoading(false);
  };

  const openOrder = async (order: Order) => {
    setSelectedOrder(order);
    setShowModal(true);
    const items = await getOrderItems(order.id);
    setOrderItems(items);
  };

  const handleReprint = async () => {
    if (!selectedOrder) return;
    try {
      await printInvoice(selectedOrder, orderItems);
    } catch (e: any) {
      Alert.alert(t("history.printFailed"), e?.message ?? t("history.couldNotPrint"));
    }
  };

  const handleSavePdf = async () => {
    if (!selectedOrder) return;
    try {
      await saveInvoicePdf(selectedOrder, orderItems);
    } catch (e: any) {
      Alert.alert(t("history.saveFailed"), e?.message ?? t("history.couldNotSave"));
    }
  };

  const handleEdit = () => {
    // Navigation to edit bill screen (to be implemented)
    Alert.alert(t("history.editBill"), t("history.editComingSoon"));
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("history.title")}</Text>
      </View>
      <FlatList
        data={orders}
        keyExtractor={(item) => item.id}
        style={styles.list}
        refreshing={loading}
        onRefresh={loadOrders}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => openOrder(item)}>
            <View style={styles.info}>
              <Text style={styles.orderId}>
                {t("history.order")} #{item.id.slice(-6)}
              </Text>
              <Text style={styles.date}>{formatDateTime(item.date)}</Text>
              <Text style={styles.customer}>
                {item.customer_name || t("history.walkIn")}
              </Text>
            </View>
            <Text style={styles.amount}>{formatCurrency(item.final_amount)}</Text>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={Colors.textMuted}
            />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <EmptyState
            icon="receipt-outline"
            title={t("history.noOrders")}
            subtitle={t("history.noOrdersFound")}
          />
        }
      />
      <Modal
        visible={showModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t("history.invoice")}</Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Ionicons name="close" size={24} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            {selectedOrder && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.label}>
                  {t("history.orderId")}:{" "}
                  <Text style={styles.value}>{selectedOrder.id}</Text>
                </Text>
                <Text style={styles.label}>
                  {t("history.date")}:{" "}
                  <Text style={styles.value}>
                    {formatDateTime(selectedOrder.date)}
                  </Text>
                </Text>
                <Text style={styles.label}>
                  {t("history.customer")}:{" "}
                  <Text style={styles.value}>
                    {selectedOrder.customer_name || t("history.walkIn")}
                  </Text>
                </Text>
                <Text style={styles.label}>
                  {t("history.payment")}:{" "}
                  <Text style={styles.value}>
                    {payLabel(selectedOrder.payment_mode)}
                  </Text>
                </Text>
                <AppCard style={styles.itemsCard}>
                  {orderItems.map((item, idx) => (
                    <View key={idx} style={styles.itemRow}>
                      <View style={styles.itemInfo}>
                        <Text style={styles.itemName}>{item.product_name}</Text>
                        <Text style={styles.itemDetail}>
                          {t("history.sizeDetail", {
                            size: item.size,
                            qty: item.quantity,
                          })}
                        </Text>
                      </View>
                      <Text style={styles.itemPrice}>
                        {formatCurrency(item.price * item.quantity)}
                      </Text>
                    </View>
                  ))}
                </AppCard>
                <View style={styles.summary}>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryText}>
                      {t("history.subtotal")}
                    </Text>
                    <Text style={styles.summaryValue}>
                      {formatCurrency(selectedOrder.total_amount)}
                    </Text>
                  </View>
                  {!!selectedOrder.discount && (
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryText}>
                        {t("history.discount")}
                      </Text>
                      <Text style={[styles.summaryValue, styles.summaryNegative]}>
                        -{formatCurrency(selectedOrder.discount)}
                      </Text>
                    </View>
                  )}
                  {!!selectedOrder.tax && (
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryText}>{t("history.tax")}</Text>
                      <Text style={styles.summaryValue}>
                        +{formatCurrency(selectedOrder.tax)}
                      </Text>
                    </View>
                  )}
                  <View style={styles.summaryTotalRow}>
                    <Text style={styles.summaryTotal}>
                      {t("history.total")}
                    </Text>
                    <Text style={styles.summaryTotalValue}>
                      {formatCurrency(selectedOrder.final_amount)}
                    </Text>
                  </View>
                </View>
                <View style={styles.actionRow}>
                  <AppButton
                    title={t("history.reprint")}
                    onPress={handleReprint}
                    size="sm"
                    style={{ flex: 1, marginRight: Spacing.md }}
                  />
                  <AppButton
                    title={t("history.savePdf")}
                    onPress={handleSavePdf}
                    size="sm"
                    variant="secondary"
                    style={{ flex: 1 }}
                  />
                </View>
                <AppButton
                  title={t("history.editBill")}
                  onPress={handleEdit}
                  size="sm"
                  variant="ghost"
                  style={styles.editBtn}
                />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.xl,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  title: {
    color: Colors.text,
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
  },
  list: { flex: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  info: { flex: 1 },
  orderId: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: FontWeight.medium,
  },
  date: { color: Colors.textMuted, fontSize: FontSize.sm },
  customer: { color: Colors.textSecondary, fontSize: FontSize.sm },
  amount: {
    color: Colors.primary,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    marginRight: Spacing.md,
  },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay },
  modalContent: {
    flex: 1,
    marginTop: 60,
    backgroundColor: Colors.background,
    borderTopLeftRadius: BorderRadius.xxl,
    borderTopRightRadius: BorderRadius.xxl,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  modalTitle: {
    color: Colors.text,
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
  },
  label: { color: Colors.textSecondary, fontSize: FontSize.sm, marginTop: 2 },
  value: { color: Colors.text, fontWeight: FontWeight.medium },
  itemsCard: { marginTop: Spacing.md, marginBottom: Spacing.md },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.sm,
  },
  itemInfo: { flex: 1, marginRight: Spacing.md },
  itemName: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: FontWeight.medium,
  },
  itemDetail: { color: Colors.textMuted, fontSize: FontSize.sm, marginTop: 2 },
  itemPrice: {
    color: Colors.textSecondary,
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
  },
  summary: { marginTop: Spacing.md },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: Spacing.xs,
  },
  summaryText: { color: Colors.textSecondary, fontSize: FontSize.md },
  summaryValue: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.medium },
  summaryNegative: { color: Colors.danger },
  summaryTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    marginTop: Spacing.sm,
    paddingTop: Spacing.md,
  },
  summaryTotal: {
    color: Colors.text,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
  },
  summaryTotalValue: {
    color: Colors.success,
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
  },
  actionRow: {
    flexDirection: "row",
    marginTop: Spacing.lg,
    marginBottom: Spacing.md,
  },
  editBtn: {
    marginTop: 0,
    marginBottom: Spacing.xxxl,
  },
});