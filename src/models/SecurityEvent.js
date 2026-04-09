const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const SecurityEvent = sequelize.define(
    'SecurityEvent',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      type: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'user_id',
      },
      ip: {
        type: DataTypes.STRING(45),
        allowNull: true,
      },
      userAgent: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'user_agent',
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
    },
    {
      tableName: 'security_event',
      paranoid: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
      indexes: [{ fields: ['type'] }, { fields: ['user_id'] }, { fields: ['created_at'] }],
    }
  );

  return SecurityEvent;
};
