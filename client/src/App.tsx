
import { useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  Clock3,
  Factory,
  Filter,
  LayoutDashboard,
  Menu,
  MoreHorizontal,
  Package,
  Plus,
  Search,
  Settings2,
  Shirt,
  Truck,
  Users,
  X,
} from 'lucide-react'
import './App.css'

type Order = {
  po: string
  buyer: string
  country: string
  style: string
  colour: string
  quantity: number
  completed: number
  stage: string
  unit: string
  shipDate: string
  risk: 'On track' | 'At risk' | 'Delayed'
}

const initialOrders: Order[] = [
  {
    po: 'B-PO-88213',
    buyer: 'Company B',
    country: 'United Kingdom',
    style: "Men's crew neck tee",
    colour: 'Navy',
    quantity: 12000,
    completed: 6800,
    stage: 'Stitching',
    unit: 'Unit 01',
    shipDate: '20 Nov 2026',
    risk: 'On track',
  },
  {
    po: 'B-PO-88240',
    buyer: 'Company B',
    country: 'United Kingdom',
    style: "Men's polo",
    colour: 'White',
    quantity: 8000,
    completed: 5200,
    stage: 'Finishing',
    unit: 'Unit 02',
    shipDate: '12 Nov 2026',
    risk: 'At risk',
  },
  {
    po: 'C-PO-0488',
    buyer: 'Company C',
    country: 'Germany',
    style: 'Kids printed tee',
    colour: 'Yellow',
    quantity: 10000,
    completed: 3100,
    stage: 'Printing',
    unit: 'Unit 03',
    shipDate: '28 Nov 2026',
    risk: 'Delayed',
  },
]

const navigation = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Orders', icon: ClipboardList },
  { label: 'Production', icon: Factory },
  { label: 'TNA Calendar', icon: CalendarDays },
]

const secondaryNavigation = [
  { label: 'Buyers', icon: Users },
  { label: 'Dispatch', icon: Truck },
  { label: 'Settings', icon: Settings2 },
]

const formatNumber = (value: number) =>
  new Intl.NumberFormat('en-IN').format(value)

function App() {
  const [orders] = useState(initialOrders)
  const [activeNav, setActiveNav] = useState('Overview')
  const [activeFilter, setActiveFilter] = useState('All orders')
  const [search, setSearch] = useState('')
  const [showNotifications, setShowNotifications] = useState(false)
  const [mobileMenu, setMobileMenu] = useState(false)

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const matchesFilter =
        activeFilter === 'All orders' ||
        order.risk === activeFilter

      const searchText = search.toLowerCase()
      const matchesSearch =
        order.po.toLowerCase().includes(searchText) ||
        order.buyer.toLowerCase().includes(searchText) ||
        order.style.toLowerCase().includes(searchText)

      return matchesFilter && matchesSearch
    })
  }, [orders, activeFilter, search])

  const totalOrders = orders.length
  const atRisk = orders.filter((o) => o.risk === 'At risk').length
  const delayed = orders.filter((o) => o.risk === 'Delayed').length
  const onTrack = orders.filter((o) => o.risk === 'On track').length

  const totalQuantity = orders.reduce((sum, o) => sum + o.quantity, 0)
  const completedQuantity = orders.reduce(
    (sum, o) => sum + o.completed,
    0,
  )

  const completion = Math.round(
    (completedQuantity / totalQuantity) * 100,
  )

  const navClick = (label: string) => {
    setActiveNav(label)
    setMobileMenu(false)
  }

  return (
    <div className="app-shell">
      {mobileMenu && (
        <button
          className="mobile-overlay"
          onClick={() => setMobileMenu(false)}
          aria-label="Close navigation"
        />
      )}

      <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-symbol">
            <Shirt size={23} strokeWidth={1.7} />
          </div>
          <div>
            <div className="brand-name">STITCHFLOW</div>
            <div className="brand-caption">PRODUCTION INTELLIGENCE</div>
          </div>
          <button
            className="mobile-close"
            onClick={() => setMobileMenu(false)}
            aria-label="Close menu"
          >
            <X size={19} />
          </button>
        </div>

        <div className="workspace-label">WORKSPACE</div>

        <nav className="nav-list">
          {navigation.map(({ label, icon: Icon }) => (
            <button
              key={label}
              onClick={() => navClick(label)}
              className={`nav-item ${activeNav === label ? 'active' : ''}`}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
              {label === 'Orders' && (
                <span className="nav-count">{totalOrders}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="workspace-label secondary-label">MANAGEMENT</div>

        <nav className="nav-list">
          {secondaryNavigation.map(({ label, icon: Icon }) => (
            <button
              key={label}
              onClick={() => navClick(label)}
              className={`nav-item ${activeNav === label ? 'active' : ''}`}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-spacer" />

        <div className="factory-card">
          <div className="factory-icon">
            <Factory size={19} />
          </div>
          <div className="factory-info">
            <strong>Company A</strong>
            <span>Tiruppur, India</span>
          </div>
          <span className="online-dot" />
        </div>

        <div className="profile">
          <div className="avatar">AG</div>
          <div className="profile-info">
            <strong>Admin User</strong>
            <span>Merchandiser</span>
          </div>
          <MoreHorizontal size={20} className="profile-more" />
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu-button"
              onClick={() => setMobileMenu(true)}
              aria-label="Open menu"
            >
              <Menu size={21} />
            </button>
            <div className="breadcrumb">
              <span>Workspace</span>
              <span className="breadcrumb-divider">/</span>
              <strong>{activeNav}</strong>
            </div>
          </div>

          <div className="topbar-right">
            <div className="live-indicator">
              <span />
              LIVE WORKSPACE
            </div>
            <button
              className="icon-button notification-button"
              onClick={() => setShowNotifications(!showNotifications)}
              aria-label="Notifications"
            >
              <Bell size={19} />
              <span className="notification-dot" />
            </button>
            <button className="help-button">
              <CircleHelp size={17} />
              <span>Help</span>
            </button>
          </div>

          {showNotifications && (
            <div className="notification-panel">
              <strong>Notifications</strong>
              <p>One order requires attention.</p>
              <p>One order is currently delayed.</p>
            </div>
          )}
        </header>

        <div className="page-content">
          <section className="page-heading">
            <div>
              <div className="eyebrow">MONDAY, 03 NOVEMBER 2026</div>
              <h1>
                Production <span>overview.</span>
              </h1>
              <p className="page-description">
                A clear picture of what's moving, what's waiting,
                and what needs your attention.
              </p>
            </div>

            <button
              className="primary-button"
              onClick={() => navClick('Orders')}
            >
              <Plus size={18} />
              New order
            </button>
          </section>

          <section className="stats-grid">
            <article className="stat-card">
              <div className="stat-top">
                <span>Total active orders</span>
                <div className="stat-icon neutral">
                  <Package size={19} />
                </div>
              </div>
              <div className="stat-value">{totalOrders}</div>
              <div className="stat-bottom">
                <span className="stat-note">Across all production units</span>
              </div>
            </article>

            <article className="stat-card">
              <div className="stat-top">
                <span>On track</span>
                <div className="stat-icon positive">
                  <CheckCircle2 size={19} />
                </div>
              </div>
              <div className="stat-value">{onTrack}</div>
              <div className="stat-bottom">
                <span className="status-dot green" />
                <span className="stat-note">Within production plan</span>
              </div>
            </article>

            <article className="stat-card">
              <div className="stat-top">
                <span>At risk</span>
                <div className="stat-icon warning">
                  <AlertTriangle size={19} />
                </div>
              </div>
              <div className="stat-value">{atRisk}</div>
              <div className="stat-bottom">
                <span className="status-dot amber" />
                <span className="stat-note">Needs closer monitoring</span>
              </div>
            </article>

            <article className="stat-card">
              <div className="stat-top">
                <span>Delayed</span>
                <div className="stat-icon danger">
                  <Clock3 size={19} />
                </div>
              </div>
              <div className="stat-value">{delayed}</div>
              <div className="stat-bottom">
                <span className="status-dot red" />
                <span className="stat-note">Requires intervention</span>
              </div>
            </article>
          </section>

          <section className="insight-grid">
            <article className="production-card">
              <div className="section-heading">
                <div>
                  <div className="eyebrow">FACTORY PERFORMANCE</div>
                  <h2>Production progress</h2>
                </div>
                <span className="period-tag">Current orders</span>
              </div>

              <div className="production-number-row">
                <div>
                  <div className="big-percentage">{completion}%</div>
                  <div className="muted-text">Overall quantity completed</div>
                </div>
                <div className="production-legend">
                  <span><i className="legend-complete" /> Completed</span>
                  <span><i className="legend-remaining" /> Remaining</span>
                </div>
              </div>

              <div className="progress-track">
                <div
                  className="progress-completed"
                  style={{ width: `${completion}%` }}
                />
              </div>

              <div className="production-footer">
                <div>
                  <strong>{formatNumber(completedQuantity)}</strong>
                  <span>Pieces completed</span>
                </div>
                <div>
                  <strong>
                    {formatNumber(totalQuantity - completedQuantity)}
                  </strong>
                  <span>Pieces remaining</span>
                </div>
                <div>
                  <strong>{formatNumber(totalQuantity)}</strong>
                  <span>Total order quantity</span>
                </div>
              </div>
            </article>

            <article className="attention-card">
              <div className="attention-header">
                <div className="attention-icon">
                  <Activity size={18} />
                </div>
                <span>ATTENTION REQUIRED</span>
              </div>

              <div className="attention-number">{atRisk + delayed}</div>
              <h3>Orders need attention</h3>
              <p>
                {atRisk} at-risk and {delayed} delayed orders
                are currently flagged in the sample workspace.
              </p>
              <button
                className="attention-link"
                onClick={() => setActiveFilter('At risk')}
              >
                Review at-risk orders <ArrowUpRight size={16} />
              </button>
            </article>
          </section>

          <section className="orders-section">
            <div className="orders-heading">
              <div>
                <div className="eyebrow">ORDER MANAGEMENT</div>
                <h2>Production orders</h2>
                <p>Monitor progress across buyers and production units.</p>
              </div>
              <button className="text-button">
                View all orders <ArrowUpRight size={16} />
              </button>
            </div>

            <div className="table-toolbar">
              <div className="filter-tabs">
                {['All orders', 'On track', 'At risk', 'Delayed'].map(
                  (filter) => (
                    <button
                      key={filter}
                      className={`filter-tab ${activeFilter === filter ? 'selected' : ''}`}
                      onClick={() => setActiveFilter(filter)}
                    >
                      {filter}
                      {filter === 'All orders' && (
                        <span>{totalOrders}</span>
                      )}
                    </button>
                  ),
                )}
              </div>

              <div className="table-actions">
                <div className="search-box">
                  <Search size={16} />
                  <input
                    placeholder="Search orders..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search && (
                    <button onClick={() => setSearch('')} aria-label="Clear search">
                      <X size={14} />
                    </button>
                  )}
                </div>
                <button className="filter-button">
                  <Filter size={16} />
                  <span>Filter</span>
                  <ChevronDown size={14} />
                </button>
              </div>
            </div>

            <div className="table-scroll">
              <table className="orders-table">
                <thead>
                  <tr>
                    <th>ORDER / BUYER</th>
                    <th>PRODUCT</th>
                    <th>PRODUCTION</th>
                    <th>STAGE</th>
                    <th>EX-FACTORY</th>
                    <th>STATUS</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => {
                    const percentage = Math.round(
                      (order.completed / order.quantity) * 100,
                    )

                    return (
                      <tr key={order.po}>
                        <td>
                          <strong className="po-number">{order.po}</strong>
                          <span className="cell-subtext">
                            {order.buyer} · {order.country}
                          </span>
                        </td>
                        <td>
                          <strong>{order.style}</strong>
                          <span className="cell-subtext">
                            {order.colour} · {order.unit}
                          </span>
                        </td>
                        <td>
                          <div className="quantity-label">
                            {formatNumber(order.completed)}
                            <span> / {formatNumber(order.quantity)}</span>
                          </div>
                          <div className="mini-progress">
                            <div
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                          <span className="cell-subtext">
                            {percentage}% complete
                          </span>
                        </td>
                        <td>
                          <span className="stage-label">{order.stage}</span>
                        </td>
                        <td>
                          <span className="date-label">{order.shipDate}</span>
                        </td>
                        <td>
                          <span
                            className={`risk-badge ${order.risk.toLowerCase().replace(' ', '-')}`}
                          >
                            <span />
                            {order.risk}
                          </span>
                        </td>
                        <td>
                          <button
                            className="row-more"
                            aria-label={`More options for ${order.po}`}
                          >
                            <MoreHorizontal size={19} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {filteredOrders.length === 0 && (
                <div className="empty-state">
                  <Package size={26} />
                  <strong>No matching orders</strong>
                  <span>Try changing your search or status filter.</span>
                  <button
                    onClick={() => {
                      setSearch('')
                      setActiveFilter('All orders')
                    }}
                  >
                    Clear filters
                  </button>
                </div>
              )}
            </div>

            <div className="table-footer">
              <span>Showing {filteredOrders.length} of {totalOrders} sample orders</span>
              <span>Last updated: Demo data</span>
            </div>
          </section>

          <footer className="page-footer">
            <span>STITCHFLOW © 2026</span>
            <span>BUILT FOR BETTER PRODUCTION VISIBILITY</span>
          </footer>
        </div>
      </main>
    </div>
  )
}

export default App
